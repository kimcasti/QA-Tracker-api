import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import controller from './organization-team';

test('public invitation metadata requires valid unexpired proof and never returns its hash or token', async () => {
  const token = 'ab'.repeat(32);
  const row = { documentId: 'inv-1', email: 'private@example.com', status: 'pending',
    tokenHash: createHash('sha256').update(token).digest('hex'), tokenExpiresAt: '2999-01-01T00:00:00.000Z',
    organization: { documentId: 'org-1', name: 'Private Org' }, organizationRole: { code: 'viewer', name: 'Viewer' } };
  const previous = globalThis.strapi;
  globalThis.strapi = { db: { query: () => ({ findOne: async () => row }) },
    documents: () => ({ findOne: async () => row }) } as any;
  const context = (secret?: string) => ({ params: { documentId: 'inv-1' },
    get: () => secret, set() {}, body: undefined as any });
  try {
    await assert.rejects(() => controller.publicInvitation(context()), /invalid or expired/i);
    await assert.rejects(() => controller.publicInvitation(context('cd'.repeat(32))), /invalid or expired/i);
    const ctx = context(token);
    await controller.publicInvitation(ctx);
    assert.equal(ctx.body.data.email, 'private@example.com');
    assert.equal(JSON.stringify(ctx.body).includes(token), false);
    assert.equal(JSON.stringify(ctx.body).includes(row.tokenHash), false);
    row.status = 'accepted';
    await assert.rejects(() => controller.publicInvitation(context(token)), /invalid or expired/i);
  } finally { globalThis.strapi = previous; }
});
