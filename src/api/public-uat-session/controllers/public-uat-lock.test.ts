import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import createController from './public-uat-session';

async function withSession(locked: boolean, action: (f: any) => Promise<void>) {
  const previousSecret = process.env.PUBLIC_UAT_TOKEN_SECRET;
  const previousStrapi = (globalThis as any).strapi;
  process.env.PUBLIC_UAT_TOKEN_SECRET = 'isolated-uat-lock-regression-secret';
  const activatedAt = '2026-01-01T00:00:00.000Z';
  const base = `session-lock.${Date.parse(activatedAt)}`;
  // Construct a valid token so the regression reaches the write authorization.
  const signature = crypto.createHmac('sha256', process.env.PUBLIC_UAT_TOKEN_SECRET).update(base).digest('base64url');
  const token = `${base}.${signature}`;
  const result = { documentId: 'result-lock', result: 'passed' };
  const session = {
    documentId: 'session-lock', activatedAt, status: 'active', completionLocked: locked,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: '2999-01-01T00:00:00.000Z',
    allowResultEditing: true, allowCommentEditing: true, allowEvidenceUpload: true,
    testRun: { documentId: 'run-lock', results: [result] },
  };
  const writes: any[] = [];
  const strapi: any = {
    contentType: () => ({ kind: 'collectionType' }),
    documents: (uid: string) => ({
      findOne: async () => session,
      update: async (input: any) => {
        writes.push({ uid, ...input });
        return uid === 'api::test-run-result.test-run-result' ? { ...result, ...input.data } : { ...session, ...input.data };
      },
    }),
  };
  (globalThis as any).strapi = strapi;
  try {
    await action({ controller: createController({ strapi }), writes,
      ctx: { params: { token, resultDocumentId: result.documentId }, request: { body: { data: { notes: 'An observation' } } }, body: undefined } });
  } finally {
    (globalThis as any).strapi = previousStrapi;
    if (previousSecret === undefined) delete process.env.PUBLIC_UAT_TOKEN_SECRET;
    else process.env.PUBLIC_UAT_TOKEN_SECRET = previousSecret;
  }
}

test('locked active UAT sessions reject result writes before any mutation', async () => {
  await withSession(true, async ({ controller, ctx, writes }) => {
    await assert.rejects(controller.submitPublicResult(ctx), { name: 'ForbiddenError', message: 'This public UAT session is read-only.' });
    assert.equal(writes.length, 0);
  });
});

test('locked active UAT sessions cannot be completed again', async () => {
  await withSession(true, async ({ controller, ctx, writes }) => {
    await assert.rejects(controller.completePublicSession(ctx), { name: 'ForbiddenError', message: 'This public UAT session is already closed.' });
    assert.equal(writes.length, 0);
  });
});

test('unlocked active UAT sessions retain valid result editing', async () => {
  await withSession(false, async ({ controller, ctx, writes }) => {
    await controller.submitPublicResult(ctx);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].uid, 'api::test-run-result.test-run-result');
    assert.equal(ctx.body.data.notes, 'An observation');
  });
});

test('unlocked active UAT sessions complete and finalize the test run', async () => {
  await withSession(false, async ({ controller, ctx, writes }) => {
    await controller.completePublicSession(ctx);
    assert.equal(writes.length, 2);
    assert.equal(writes[0].uid, 'api::public-uat-session.public-uat-session');
    assert.equal(writes[0].data.status, 'completed');
    assert.equal(writes[0].data.completionLocked, true);
    assert.equal(writes[1].uid, 'api::test-run.test-run');
    assert.equal(writes[1].documentId, 'run-lock');
    assert.equal(writes[1].data.status, 'final');
  });
});
