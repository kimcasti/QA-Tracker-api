import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Database } from '@strapi/database';
import { createAuthService } from './auth';
import { getUserProjectAccessScope } from '../../../utils/tenant';
import { rotateInvitationSecretAndSend, verifyInvitationProof } from '../../../utils/invitation-tokens';

const token = 'ab'.repeat(32);
const hash = createHash('sha256').update(token).digest('hex');
const now = '2026-10-15T12:00:00.000Z';
function fixture() {
  let committed = { invitation: { documentId: 'inv', email: 'existing@example.com', status: 'pending',
    tokenHash: hash as string | null, tokenExpiresAt: '2026-10-17T12:00:00.000Z' as string | null,
    organization: { documentId: 'org' }, organizationRole: { code: 'viewer' },
    workspaceProjectDocumentIds: ['new-project'] }, memberships: ['prior-membership'] };
  let working: typeof committed;
  const hooks = { beforeOpen: async () => {}, link: async () => {}, failCommit: false };
  const writes: any[] = [];
  const strapi: any = {
    db: {
      inTransaction: Database.prototype.inTransaction, transaction: Database.prototype.transaction,
      connection: { transaction: async () => {
        await hooks.beforeOpen();
        working = structuredClone(committed);
        return { commit: async () => {
          if (hooks.failCommit) throw new Error('commit failed');
          committed = structuredClone(working);
        }, rollback: async () => {} };
      } },
      query: (uid: string) => uid === 'plugin::users-permissions.user' ? {
        findOne: async () => ({ id: 55, username: 'existing', email: 'existing@example.com',
          password: bcrypt.hashSync('correct-password', 4), confirmed: true }),
      } : {
        findOne: async () => structuredClone((strapi.db.inTransaction() ? working : committed).invitation),
        updateMany: async ({ where, data }: any) => {
          const row = (strapi.db.inTransaction() ? working : committed).invitation;
          const matches = Object.entries(where).every(([key, value]: any) =>
            value && typeof value === 'object' && '$gt' in value
              ? row[key] !== null && row[key] > value.$gt : row[key] === value);
          writes.push({ where, data, transaction: strapi.db.inTransaction(), matches });
          if (!matches) return { count: 0 };
          Object.assign(row, data); return { count: 1 };
        },
      },
    },
    plugin: () => ({ service: (name: string) => name === 'user'
      ? { validatePassword: bcrypt.compare } : { issue: async () => 'jwt-55' } }),
    // Deliberately read committed state: model a different request observing
    // project authorization while acceptance's transaction is still in flight.
    documents: () => ({ findMany: async ({ filters }: any) => [
      // Previously accepted project access must remain intact throughout.
      { workspaceProjectDocumentIds: ['prior-project'] },
      ...(committed.invitation.status === filters.status ? [structuredClone(committed.invitation)] : []),
    ] }),
  };
  const scope = () => getUserProjectAccessScope(strapi, 55, [{ documentId: 'prior-membership',
    organization: { documentId: 'org' }, organizationRole: { code: 'viewer' } }] as any);
  const service = createAuthService({ strapi, dependencies: { getNowIso: () => now,
    linkMembershipForRole: async () => {
      assert.equal(strapi.db.inTransaction(), true);
      working.memberships.push('new-membership'); await hooks.link();
    },
  } });
  const payload = { email: 'existing@example.com', password: 'correct-password',
    invitationDocumentId: 'inv', invitationToken: token };
  return { service, payload, hooks, scope, strapi, writes, state: () => committed };
}

test('accepted publication commits with access, never before opening or during the transaction', async () => {
  const f = fixture();
  f.hooks.beforeOpen = async () => {
    assert.equal(f.state().invitation.status, 'pending');
    assert.deepEqual((await f.scope()).allowedProjectDocumentIds, ['prior-project']);
    assert.equal(f.state().invitation.tokenExpiresAt, null);
    await assert.rejects(() => verifyInvitationProof(f.strapi, { documentId: 'inv', token, nowIso: now }), /invalid or expired/i);
  };
  f.hooks.link = async () => assert.deepEqual((await f.scope()).allowedProjectDocumentIds, ['prior-project']);
  assert.equal((await f.service.acceptInvitation(f.payload)).jwt, 'jwt-55');
  assert.equal(f.state().invitation.status, 'accepted');
  assert.equal(f.state().invitation.tokenHash, null);
  assert.deepEqual((await f.scope()).allowedProjectDocumentIds, ['prior-project', 'new-project']);
  assert.deepEqual(f.state().memberships, ['prior-membership', 'new-membership']);
  assert.equal(f.writes.filter(write => write.data.status === 'accepted').every(write => write.transaction), true);
});

test('failure to open a transaction leaves proof burned and prior project authorization unchanged', async () => {
  const f = fixture();
  f.hooks.beforeOpen = async () => { throw new Error('open failed'); };
  await assert.rejects(() => f.service.acceptInvitation(f.payload), /open failed/);
  assert.equal(f.state().invitation.status, 'pending');
  assert.equal(f.state().invitation.tokenExpiresAt, null);
  assert.deepEqual((await f.scope()).allowedProjectDocumentIds, ['prior-project']);
  assert.deepEqual(f.state().memberships, ['prior-membership']);
  await assert.rejects(() => f.service.acceptInvitation(f.payload), /invalid or expired/i);
});

test('callback and commit failure rollback publication and access without restoring proof', async () => {
  for (const failure of ['link', 'commit']) {
    const f = fixture();
    if (failure === 'link') f.hooks.link = async () => { throw new Error('link failed'); };
    else f.hooks.failCommit = true;
    await assert.rejects(() => f.service.acceptInvitation(f.payload), /failed/);
    assert.equal(f.state().invitation.status, 'pending');
    assert.equal(f.state().invitation.tokenHash, hash);
    assert.equal(f.state().invitation.tokenExpiresAt, null);
    assert.deepEqual((await f.scope()).allowedProjectDocumentIds, ['prior-project']);
    assert.deepEqual(f.state().memberships, ['prior-membership']);
    await assert.rejects(() => f.service.acceptInvitation(f.payload), /invalid or expired/i);
  }
});

test('publication CAS cannot overwrite a concurrent resend, including a failed delivery', async () => {
  for (const deliveryFails of [false, true]) {
    const f = fixture();
    let replacement = '';
    f.hooks.beforeOpen = async () => {
      const resend = rotateInvitationSecretAndSend(f.strapi, 'inv', async secret => {
        replacement = secret;
        if (deliveryFails) throw new Error('SMTP failed');
      }, now);
      if (deliveryFails) await assert.rejects(() => resend, /SMTP failed/);
      else await resend;
    };
    await assert.rejects(() => f.service.acceptInvitation(f.payload), /invalid or expired/i);
    assert.equal(f.state().invitation.status, 'pending');
    assert.equal(f.state().invitation.tokenHash, deliveryFails ? null : createHash('sha256').update(replacement).digest('hex'));
    assert.deepEqual((await f.scope()).allowedProjectDocumentIds, ['prior-project']);
    assert.deepEqual(f.state().memberships, ['prior-membership']);
    const publication = f.writes.find(write => write.data.status === 'accepted');
    assert.equal(publication?.where.tokenHash, hash);
    assert.equal(publication?.where.tokenExpiresAt, null);
    assert.equal(publication?.where.status, 'pending');
  }
});
