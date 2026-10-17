import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as tokens from './invitation-tokens';

test('invitation secrets are random 256-bit tokens stored only as SHA-256 hashes with 48h expiry', () => {
  const now = '2026-10-15T12:00:00.000Z';
  const first = tokens.createInvitationSecret(now);
  const second = tokens.createInvitationSecret(now);
  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.data.tokenHash, createHash('sha256').update(first.token).digest('hex'));
  assert.notEqual(first.data.tokenHash, first.token);
  assert.equal(first.data.tokenExpiresAt, '2026-10-17T12:00:00.000Z');
  assert.equal(JSON.stringify(first.data).includes(first.token), false);
});

const now = '2026-10-15T12:00:00.000Z';
const token = 'ab'.repeat(32);
test('resend rotates legacy proof before delivery and invalidates it if delivery fails', async () => {
  const invitation = row({ tokenHash: null, tokenExpiresAt: null });
  const writes: any[] = [];
  const strapi = { db: { query: () => ({
    findOne: async () => ({ ...invitation }),
    updateMany: async ({ where, data }: any) => {
      if (where.tokenHash !== invitation.tokenHash || where.status !== invitation.status) return { count: 0 };
      writes.push(data); Object.assign(invitation, data); return { count: 1 };
    },
  }) } } as any;
  let delivered = '';
  await tokens.rotateInvitationSecretAndSend(strapi, 'inv-1', async secret => {
    delivered = secret;
    assert.equal(invitation.tokenHash, createHash('sha256').update(secret).digest('hex'));
    assert.equal(invitation.status, 'pending');
  }, now);
  assert.notEqual(delivered, token);
  assert.equal(invitation.tokenExpiresAt, '2026-10-17T12:00:00.000Z');
  await assert.rejects(() => tokens.rotateInvitationSecretAndSend(strapi, 'inv-1', async () => {
    throw new Error('SMTP failed');
  }, now), /SMTP failed/);
  assert.equal(invitation.tokenHash, null);
  assert.equal(invitation.tokenExpiresAt, null);
  invitation.status = 'accepted';
  await assert.rejects(() => tokens.rotateInvitationSecretAndSend(strapi, 'inv-1', async () => {
    throw new Error('must not send');
  }, now), /already accepted/i);
  assert.equal(writes.length, 3);
});
function row(overrides: any = {}) {
  return { id: 17, documentId: 'inv-1', email: 'invited@example.com', status: 'pending',
    tokenHash: createHash('sha256').update(token).digest('hex'), tokenExpiresAt: '2026-10-17T12:00:00.000Z',
    organization: { documentId: 'org-1' }, organizationRole: { code: 'viewer' }, ...overrides };
}
function database(invitation: any) {
  const calls: any[] = [];
  return { calls, strapi: { db: { query: () => ({
    findOne: async () => invitation,
    updateMany: async ({ where, data }: any) => {
      calls.push({ where, data });
      const matches = invitation.status === where.status && invitation.tokenHash === where.tokenHash
        && invitation.email === where.email && invitation.documentId === where.documentId
        && invitation.tokenExpiresAt > where.tokenExpiresAt.$gt;
      if (!matches) return { count: 0 };
      Object.assign(invitation, data);
      return { count: 1 };
    },
  }) } } as any };
}

test('consumption atomically admits exactly one concurrent claimant and rejects replay', async () => {
  const db = database(row());
  const proof = { documentId: 'inv-1', token, email: 'invited@example.com', nowIso: now };
  const results = await Promise.allSettled([
    tokens.consumeInvitationProof(db.strapi, proof), tokens.consumeInvitationProof(db.strapi, proof),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  await assert.rejects(() => tokens.consumeInvitationProof(db.strapi, proof), /invalid or expired/i);
  // A burned hash with no expiry is an unusable, claim-specific CAS marker,
  // not an authorization publication (accepted invitations grant projects).
  assert.equal(db.calls[0].data.tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.equal(db.calls[0].data.tokenExpiresAt, null);
  assert.equal(db.calls[0].data.status, 'pending');
});

test('invitation proof rejects missing, malformed, wrong, expired, spent and legacy tokens without writes', async () => {
  const cases = [
    { token: undefined }, { token: '' }, { token: 'invalid' }, { token: 'cd'.repeat(32) },
    { token, overrides: { tokenExpiresAt: now } }, { token, overrides: { tokenExpiresAt: 'invalid' } },
    { token, overrides: { status: 'accepted' } }, { token, overrides: { status: 'cancelled' } },
    { token, overrides: { tokenHash: null } }, { token, overrides: { tokenExpiresAt: null } },
    { token, email: 'other@example.com' }, { token, documentId: 'another-invitation' },
  ];
  for (const item of cases) {
    const db = database(row(item.overrides));
    await assert.rejects(() => tokens.verifyInvitationProof(db.strapi, {
      documentId: item.documentId || 'inv-1', token: item.token, email: item.email || 'invited@example.com', nowIso: now,
    }), /invalid or expired/i);
    assert.equal(db.calls.length, 0);
  }
});
