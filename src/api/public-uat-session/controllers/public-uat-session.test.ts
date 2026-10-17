import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { errors } from '@strapi/utils';
import createController from './public-uat-session';

const run = { documentId: 'run-a', organization: { documentId: 'org-a' }, project: { documentId: 'project-a' }, testType: 'uat', results: [{ documentId: 'result-a' }] };
function fixture(participant: any, existing = false) {
  const writes: any[] = [];
  const reads: any[] = [];
  let session: any = existing ? { documentId: 'session-a' } : null;
  const strapi = {
    contentType: () => ({ kind: 'collectionType' }),
    documents: (uid: string) => {
      if (uid === 'api::test-run.test-run') return { findOne: async () => run };
      if (uid === 'api::organization-membership.organization-membership') return {
        findMany: async () => [{ documentId: 'member-a', organization: run.organization, organizationRole: { code: 'owner' } }],
      };
      if (uid === 'api::external-participant.external-participant') return {
        findFirst: async (input: any) => {
          reads.push(input);
          const filters = input.filters;
          const projectMatches = !filters.$or || filters.$or.some((condition: any) =>
            condition.sourceProject?.documentId
              ? participant?.sourceProject?.documentId === condition.sourceProject.documentId
              : condition.sourceProject?.id?.$null === true && participant?.sourceProject == null);
          return participant?.documentId === filters.documentId && participant?.organization?.documentId === filters.organization.documentId && projectMatches ? participant : null;
        },
      };
      if (uid === 'api::public-uat-session.public-uat-session') return {
        findFirst: async () => session,
        findOne: async () => session,
        create: async (input: any) => { writes.push(input); session = { documentId: 'session-a', ...input.data }; return session; },
        update: async (input: any) => {
          writes.push(input);
          session = { ...session, ...input.data, testRun: run, externalParticipant: input.data.externalParticipant === null ? null : participant };
          return session;
        },
      };
      throw new Error(`Unexpected uid ${uid}`);
    },
  } as any;
  const controller = createController({ strapi });
  const ctx = { state: { user: { id: 1 } }, params: { documentId: run.documentId }, request: { body: { data: { externalParticipant: participant?.documentId } } }, body: undefined as any };
  return { strapi, controller, ctx, writes, reads };
}
async function activate(f: ReturnType<typeof fixture>) {
  const old = (globalThis as any).strapi;
  (globalThis as any).strapi = f.strapi;
  try { await f.controller.activate(f.ctx); } finally { (globalThis as any).strapi = old; }
}
for (const sourceProject of [run.project, null]) {
  for (const existing of [false, true]) {
    test(`activate accepts scoped participant, sourceProject=${sourceProject?.documentId || 'none'}, existing=${existing}`, async () => {
      const participant = { documentId: 'person-a', organization: run.organization, sourceProject, name: 'Allowed Person', email: 'allowed@example.test' };
      const f = fixture(participant, existing);
      await activate(f);
      assert.equal(f.writes.length, existing ? 1 : 2);
      assert.equal(f.ctx.body.data.participant.documentId, participant.documentId);
      assert.equal(f.ctx.body.data.participant.email, participant.email);
      assert.equal(f.writes.at(-1).data.externalParticipant, participant.documentId);
      assert.deepEqual(f.reads[0], {
        filters: { documentId: participant.documentId, organization: { documentId: 'org-a' }, $or: [
          { sourceProject: { documentId: 'project-a' } }, { sourceProject: { id: { $null: true } } },
        ] }, fields: ['documentId'],
      });
    });
  }
}
for (const externalParticipant of [null, undefined]) {
  test(`activate supports optional participant (${externalParticipant})`, async () => {
    const f = fixture(null);
    f.ctx.request.body.data.externalParticipant = externalParticipant;
    await activate(f);
    assert.equal(f.reads.length, 0);
    assert.equal(f.writes.at(-1).data.externalParticipant, null);
    assert.equal(f.ctx.body.data.participant.documentId, null);
  });
}
test('activate rejects nonexistent participant without disclosing any identity', async () => {
  const f = fixture(null);
  f.ctx.request.body.data.externalParticipant = 'missing';
  await assert.rejects(activate(f), { name: 'ValidationError', message: 'External participant is not available for this test run.' });
  assert.equal(f.writes.length, 0);
  assert.equal(f.ctx.body, undefined);
});

test('activation still issues HMAC token/hash; public read rejects tampering, expiry and revocation', async () => {
  const oldSecret = process.env.PUBLIC_UAT_TOKEN_SECRET;
  process.env.PUBLIC_UAT_TOKEN_SECRET = 'synthetic-secret-used-only-in-unit-tests';
  const f = fixture(null);
  try {
    await activate(f);
    const token = f.ctx.body.data.token;
    const [id, timestamp, signature] = token.split('.');
    assert.equal(id, 'session-a');
    assert.equal(signature, crypto.createHmac('sha256', process.env.PUBLIC_UAT_TOKEN_SECRET).update(`${id}.${timestamp}`).digest('base64url'));
    assert.equal(f.writes.at(-1).data.tokenHash, crypto.createHash('sha256').update(token).digest('hex'));
    const oldStrapi = (globalThis as any).strapi;
    (globalThis as any).strapi = f.strapi;
    try {
      const publicCtx = { params: { token }, body: undefined as any };
      await f.controller.publicSession(publicCtx);
      assert.equal(publicCtx.body.data.session.documentId, id);
      await assert.rejects(f.controller.publicSession({ params: { token: `${token}x` } }), errors.ForbiddenError);
      await f.strapi.documents('api::public-uat-session.public-uat-session').update({ data: { expiresAt: '2000-01-01T00:00:00.000Z' } });
      await assert.rejects(f.controller.publicSession({ params: { token } }), /expired/);
      await f.strapi.documents('api::public-uat-session.public-uat-session').update({ data: { expiresAt: '2999-01-01T00:00:00.000Z', status: 'revoked' } });
      await assert.rejects(f.controller.publicSession({ params: { token } }), /no longer available/);
    } finally { (globalThis as any).strapi = oldStrapi; }
  } finally {
    if (oldSecret === undefined) delete process.env.PUBLIC_UAT_TOKEN_SECRET; else process.env.PUBLIC_UAT_TOKEN_SECRET = oldSecret;
  }
});

for (const existing of [false, true]) {
  test(`activate rejects participant from another project in same tenant (existing=${existing})`, async () => {
    const f = fixture({ documentId: 'other-project-person', organization: run.organization, sourceProject: { documentId: 'project-b' } }, existing);
    await assert.rejects(activate(f), errors.ValidationError);
    assert.equal(f.writes.length, 0);
    assert.equal(f.ctx.body, undefined);
  });
}

for (const existing of [false, true]) {
  test(`activate rejects foreign tenant participant before session writes (existing=${existing})`, async () => {
    const f = fixture({ documentId: 'foreign-person', organization: { documentId: 'org-b' }, sourceProject: run.project, name: 'Private foreign name', email: 'private@example.test' }, existing);
    await assert.rejects(activate(f), errors.ValidationError);
    assert.equal(f.writes.length, 0);
    assert.equal(f.ctx.body, undefined);
  });
}
