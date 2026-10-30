import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import createController from './public-uat-session';
import internalActions from '../routes/internal-actions';
import tenantAccess from '../../../policies/tenant-access';
import { ADMIN_ROLES, EXPOSED_ACTIONS } from '../../../utils/access';

const SESSION = 'api::public-uat-session.public-uat-session';
const RUN = 'api::test-run.test-run';
function fixture() {
  const organization = { documentId: 'org-lifecycle' };
  const project = { documentId: 'project-lifecycle', organization };
  const run: any = { id: 10, documentId: 'run-lifecycle', organization, project, testType: 'uat', status: 'final',
    publicUatSession: { documentId: 'session-lifecycle' },
    results: [{ documentId: 'result-lifecycle', result: 'passed', notes: 'Keep comment', evidenceImage: '<p>Keep evidence</p>' }] };
  const activatedAt = '2026-01-01T00:00:00.000Z';
  const secret = 'synthetic-lifecycle-secret';
  const base = `session-lifecycle.${Date.parse(activatedAt)}`;
  const token = `${base}.${crypto.createHmac('sha256', secret).update(base).digest('base64url')}`;
  const session: any = { id: 20, documentId: 'session-lifecycle', organization, project, testRun: run,
    updatedAt: '2026-05-01T00:00:00.000Z',
    status: 'completed', completionLocked: true, completedAt: '2026-02-01T00:00:00.000Z',
    activatedAt, expiresAt: '2999-01-01T00:00:00.000Z', tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    participantNameSnapshot: 'Synthetic participant', participantEmailSnapshot: 'participant@example.test',
    externalParticipant: { documentId: 'person-lifecycle' }, allowResultEditing: true,
    allowCommentEditing: false, allowEvidenceUpload: true, deliveryNotes: 'Keep delivery notes' };
  const writes: any[] = [];
  const locks: any[] = [];
  const txContext = new AsyncLocalStorage<boolean>();
  let runLockTail = Promise.resolve();
  let runLockAttempt: (() => void) | undefined;
  let sessionWrite: (() => Promise<void>) | undefined;
  let transactions = 0;
  let role = 'owner';
  let failRun = false;
  let failSession = false;
  let failReadback = false;
  let failTransaction = false;
  let sessionRead: (() => Promise<void>) | undefined;
  let sessionLock: (() => void) | undefined;
  let lockedSessionStatus: string | undefined;
  let lockedSessionUpdatedAt: string | undefined;
  const strapi: any = {
    contentType: () => ({ kind: 'collectionType' }),
    db: { query: () => ({ findOne: async () => ({ email: 'owner@example.test' }) }),
      metadata: { get: (uid: string) => ({ tableName: uid, attributes: { updatedAt: { columnName: 'updated_at' } } }) }, transaction: async (callback: any) => {
      transactions++;
      if (failTransaction) throw new Error('synthetic transaction open failure');
      let beforeSession: any;
      let beforeRun: any;
      let unlock: (() => void) | undefined;
      const trx = (table: string) => ({ where: (where: any) => ({ forUpdate: () => ({ first: async () => {
        if (table === RUN) {
          const previous = runLockTail;
          runLockTail = new Promise<void>(resolve => { unlock = resolve; });
          runLockAttempt?.();
          await previous;
          beforeSession = { ...session };
          beforeRun = { ...run };
        }
        locks.push({ table, where });
        if (table === SESSION) sessionLock?.();
        return { status: table === SESSION ? lockedSessionStatus ?? session.status : run.status,
          updated_at: lockedSessionUpdatedAt ?? session.updatedAt };
      } }) }) });
      try { return await txContext.run(true, () => callback({ trx })); }
      catch (error) {
        if (beforeSession) {
          for (const key of Object.keys(session)) if (!(key in beforeSession)) delete session[key];
          for (const key of Object.keys(run)) if (!(key in beforeRun)) delete run[key];
          Object.assign(session, beforeSession);
          Object.assign(run, beforeRun);
        }
        throw error;
      }
      finally { unlock?.(); }
    } },
    documents: (uid: string) => {
      if (uid === 'api::organization-membership.organization-membership') return { findMany: async () => [
        { organization, organizationRole: { code: role } },
      ] };
      if (uid === 'api::organization-invitation.organization-invitation') return { findMany: async () => [] };
      if (uid === 'api::project.project') return { findOne: async () => project };
      return {
        findOne: async () => {
          if (uid === SESSION && failReadback && writes.length > 0) throw new Error('synthetic readback failure');
          const snapshot = structuredClone(uid === RUN ? run : session);
          if (uid === SESSION) await sessionRead?.();
          return snapshot;
        },
        findFirst: async () => {
          if (failReadback && writes.length > 0) throw new Error('synthetic readback failure');
          return structuredClone(session);
        },
        update: async (input: any) => {
          writes.push({ uid, ...input, tx: txContext.getStore() === true });
          if (uid === RUN && failRun) throw new Error('synthetic run write failure');
          if (uid === SESSION && failSession) throw new Error('synthetic session write failure');
          const target = uid === RUN ? run : session;
          Object.assign(target, input.data);
          if (uid === SESSION) await sessionWrite?.();
          return structuredClone(target);
        },
      };
    },
  };
  const controller = createController({ strapi });
  const ctx: any = { state: { user: { id: 1 } }, params: { documentId: run.documentId }, request: { body: { data: {} } } };
  let invocations = 0;
  let oldStrapi: any;
  let oldSecret: string | undefined;
  return { run, session, project, organization, controller, ctx, token, writes, locks,
    setRole: (value: string) => { role = value; }, failRun: () => { failRun = true; },
    failSession: () => { failSession = true; }, failReadback: () => { failReadback = true; },
    failTransaction: () => { failTransaction = true; },
    onSessionRead: (callback: () => Promise<void>) => { sessionRead = callback; },
    onSessionWrite: (callback: () => Promise<void>) => { sessionWrite = callback; },
    onRunLockAttempt: (callback: () => void) => { runLockAttempt = callback; },
    onSessionLock: (callback: () => void) => { sessionLock = callback; },
    setLockedSessionStatus: (status: string) => { lockedSessionStatus = status; },
    setLockedSessionUpdatedAt: (value: string) => { lockedSessionUpdatedAt = value; },
    get transactions() { return transactions; },
    async invoke(action: string, context = ctx, viaRoute = false) {
      if (invocations++ === 0) {
        oldStrapi = (globalThis as any).strapi;
        oldSecret = process.env.PUBLIC_UAT_TOKEN_SECRET;
      }
      (globalThis as any).strapi = strapi;
      process.env.PUBLIC_UAT_TOKEN_SECRET = secret;
      try {
        if (viaRoute) {
          const route = internalActions.routes.find(item => item.handler === `public-uat-session.${action}`);
          assert.ok(route, `Missing route for ${action}`);
          assert.equal(route.method, 'PUT');
          assert.equal(route.path, `/public-uat-sessions/test-runs/:documentId/${action}`);
          assert.deepEqual(route.config.auth, {});
          assert.deepEqual(route.config.policies[0].config.allowedRoles, ADMIN_ROLES);
          assert.equal(route.config.policies[0].config.contentTypeUid, RUN);
          assert.ok((EXPOSED_ACTIONS as readonly string[]).includes(`${SESSION}.${action}`));
          context.request.method = route.method;
          await tenantAccess(context, route.config.policies[0].config, { strapi });
        }
        return await controller[action](context);
      }
      finally {
        if (--invocations === 0) {
          (globalThis as any).strapi = oldStrapi;
          if (oldSecret === undefined) delete process.env.PUBLIC_UAT_TOKEN_SECRET;
          else process.env.PUBLIC_UAT_TOKEN_SECRET = oldSecret;
        }
      }
    },
  };
}

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

test('delayed expired public read cannot overwrite a committed expiration extension', async () => {
  const f = fixture();
  Object.assign(f.session, { status: 'active', completionLocked: false, completedAt: null,
    expiresAt: '2020-01-01T00:00:00.000Z' });
  f.run.status = 'draft';
  const read = barrier();
  const resume = barrier();
  f.onSessionRead(async () => { read.release(); await resume.promise; });
  const pending = assert.rejects(f.invoke('publicSession', { params: { token: f.token } }), /expired/);
  await read.promise;
  f.ctx.request.body.data.expiresAt = '2999-02-01T00:00:00.000Z';
  try { await f.invoke('expiration'); } finally { resume.release(); }
  await pending;
  assert.equal(f.session.status, 'active');
  assert.equal(f.session.expiresAt, '2999-02-01T00:00:00.000Z');
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].tx, true);
});

test('concurrent completion and reopen serialize both lifecycle records in run then session order', async () => {
  const f = fixture();
  Object.assign(f.session, { status: 'active', completionLocked: false, completedAt: null });
  f.run.status = 'draft';
  const written = barrier();
  const resume = barrier();
  let first = true;
  f.onSessionWrite(async () => {
    if (first) { first = false; written.release(); await resume.promise; }
  });
  const completeCtx: any = { params: { token: f.token } }; // no authenticated user
  const completing = f.invoke('completePublicSession', completeCtx);
  await written.promise;
  const attempted = barrier();
  f.onRunLockAttempt(attempted.release);
  const reopening = f.invoke('reopen');
  await attempted.promise;
  // Without a completion transaction, reopening can commit before its final run write.
  // With one, it must wait until the whole completion commits.
  if (f.transactions === 1) await reopening;
  resume.release();
  await Promise.all([completing, reopening]);
  assert.equal(f.session.status, 'active');
  assert.equal(f.session.completionLocked, false);
  assert.equal(f.run.status, 'draft');
  assert.equal(f.transactions, 2);
  assert.deepEqual(f.locks.map(lock => lock.table), [RUN, SESSION, RUN, SESSION]);
  assert.ok(f.writes.every(write => write.tx));
  assert.equal(completeCtx.body.data.testRun.status, 'final');
});

for (const failure of ['session', 'run', 'readback', 'transaction']) {
  test(`public completion atomically rolls back both records on ${failure} failure`, async () => {
    const f = fixture();
    Object.assign(f.session, { status: 'active', completionLocked: false, completedAt: null });
    f.run.status = 'draft';
    const before = structuredClone(f.session);
    const ctx: any = { params: { token: f.token } };
    if (failure === 'session') f.failSession();
    if (failure === 'run') f.failRun();
    if (failure === 'readback') f.failReadback();
    if (failure === 'transaction') f.failTransaction();
    await assert.rejects(f.invoke('completePublicSession', ctx), new RegExp(`synthetic ${failure}`));
    assert.deepEqual(f.session, before);
    assert.equal(f.run.status, 'draft');
    assert.equal(ctx.body, undefined);
    assert.equal(f.transactions, 1);
    assert.ok(f.writes.every(write => write.tx));
  });
}

for (const change of ['tokenHash', 'activatedAt', 'expired', 'completed', 'locked', 'pending', 'stale-sql']) {
  test(`public completion revalidates ${change} after both row locks without writes`, async () => {
    const f = fixture();
    Object.assign(f.session, { status: 'active', completionLocked: false, completedAt: null });
    f.run.status = 'draft';
    f.onSessionLock(() => {
      if (change === 'tokenHash') f.session.tokenHash = 'rotated';
      if (change === 'activatedAt') f.session.activatedAt = '2026-03-01T00:00:00.000Z';
      if (change === 'expired') f.session.expiresAt = '2020-01-01T00:00:00.000Z';
      if (change === 'completed') f.session.status = 'completed';
      if (change === 'locked') f.session.completionLocked = true;
      if (change === 'pending') f.run.results[0].result = 'not_executed';
      if (change === 'stale-sql') f.setLockedSessionUpdatedAt('2026-05-02T00:00:00.000Z');
    });
    await assert.rejects(f.invoke('completePublicSession', { params: { token: f.token } }),
      { name: ['pending', 'stale-sql'].includes(change) ? 'ValidationError' : 'ForbiddenError' });
    assert.deepEqual(f.locks.map(lock => lock.table), [RUN, SESSION]);
    assert.equal(f.writes.length, 0);
  });
}

test('reopen requires authenticated Owner or QA Lead in the run organization before any write', async () => {
  for (const role of ['qa-engineer', 'manager', 'viewer', 'foreign-owner', 'anonymous']) {
    const f = fixture();
    f.setRole(role);
    if (role === 'anonymous') f.ctx.state.user = null;
    if (role === 'foreign-owner') f.run.organization = { documentId: 'foreign-org' };
    await assert.rejects(f.invoke('reopen'), { name: role === 'anonymous' ? 'UnauthorizedError' : 'ForbiddenError' });
    assert.equal(f.writes.length, 0, role);
  }
});

for (const state of ['revoked', 'draft', 'active', 'unpublished', 'missing-token', 'revoked-at']) {
  test(`reopen rejects inappropriate transition: ${state}`, async () => {
    const f = fixture();
    if (['revoked', 'draft', 'active'].includes(state)) f.session.status = state;
    if (state === 'active') { f.session.completionLocked = false; f.session.completedAt = null; }
    if (state === 'unpublished') f.session.activatedAt = null;
    if (state === 'missing-token') f.session.tokenHash = null;
    if (state === 'revoked-at') f.session.revokedAt = '2026-03-01T00:00:00.000Z';
    await assert.rejects(f.invoke('reopen'), { name: 'ValidationError' });
    assert.equal(f.writes.length, 0);
  });
}

for (const mismatch of ['session-org', 'session-project', 'session-run', 'run-session', 'project-org', 'non-uat', 'missing-run', 'missing-session', 'missing-id']) {
  test(`reopen refuses incoherent or missing persisted scope: ${mismatch}`, async () => {
    const f = fixture();
    if (mismatch === 'session-org') f.session.organization = { documentId: 'foreign-org' };
    if (mismatch === 'session-project') f.session.project = { documentId: 'foreign-project' };
    if (mismatch === 'session-run') f.session.testRun = { documentId: 'foreign-run' };
    if (mismatch === 'run-session') f.run.publicUatSession = { documentId: 'foreign-session' };
    if (mismatch === 'project-org') f.project.organization = { documentId: 'foreign-org' };
    if (mismatch === 'non-uat') f.run.testType = 'functional';
    if (mismatch === 'missing-run') f.run.documentId = null;
    if (mismatch === 'missing-session') f.session.documentId = null;
    if (mismatch === 'missing-id') f.ctx.params.documentId = '';
    await assert.rejects(f.invoke('reopen'), (error: any) => ['ValidationError', 'NotFoundError', 'ForbiddenError'].includes(error.name));
    assert.equal(f.writes.length, 0);
  });
}

for (const expiresAt of [undefined, null, '', '2999-02-30T12:00:00Z', '2999-01-01', '2999-01-01T12:00:00', '2020-01-01T00:00:00Z', '2999-01-01T25:00:00Z', '2999-01-01T00:00:00+24:00', 99999999999999]) {
  test(`expired reopen rejects absent or invalid full future deadline: ${String(expiresAt)}`, async () => {
    const f = fixture();
    f.session.expiresAt = '2020-01-01T00:00:00.000Z';
    if (expiresAt !== undefined) f.ctx.request.body.data.expiresAt = expiresAt;
    await assert.rejects(f.invoke('reopen'), { name: 'ValidationError' });
    assert.equal(f.writes.length, 0);
  });
}

test('expired completed UAT reopens with an explicit future offset timestamp and unchanged token', async () => {
  const f = fixture();
  f.session.expiresAt = '2020-01-01T00:00:00.000Z';
  f.ctx.request.body.data.expiresAt = '2999-01-01T12:30:45-05:00';
  await f.invoke('reopen');
  assert.equal(f.ctx.body.data.expiresAt, '2999-01-01T17:30:45.000Z');
  assert.ok(f.ctx.body.data.publicUrl.endsWith(encodeURIComponent(f.token)));
});

for (const status of ['completed', 'revoked', 'active']) {
  test(`expiration edit preserves ${status} lifecycle, results, participant and token`, async () => {
    const f = fixture();
    f.session.status = status;
    if (status === 'active') { f.session.completionLocked = false; f.session.completedAt = null; f.run.status = 'draft'; }
    if (status === 'revoked') f.session.revokedAt = '2026-04-01T00:00:00.000Z';
    const before = structuredClone(f.session);
    f.ctx.request.body.data = { expiresAt: '2999-05-01T00:00:00.000Z', status: 'active', completionLocked: false, participantNameSnapshot: 'Must not replace' };
    await f.invoke('expiration');
    assert.equal(f.session.expiresAt, '2999-05-01T00:00:00.000Z');
    const after = structuredClone(f.session);
    delete before.expiresAt; delete after.expiresAt;
    assert.deepEqual(after, before);
    assert.equal(f.ctx.body.data.testRun.status, before.testRun.status);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].uid, SESSION);
    assert.deepEqual(f.writes[0].data, { expiresAt: '2999-05-01T00:00:00.000Z' });
    assert.equal(f.writes[0].tx, true);
    if (status !== 'revoked') assert.ok(f.ctx.body.data.publicUrl.endsWith(encodeURIComponent(f.token)));
    else assert.equal(f.ctx.body.data.publicUrl, null);
  });
}

for (const locked of [false, true]) {
  test(`expiration extension of expired session resumes only previously unlocked activity (locked=${locked})`, async () => {
    const f = fixture();
    f.session.status = 'expired';
    f.session.expiresAt = '2020-01-01T00:00:00.000Z';
    f.session.completionLocked = locked;
    f.session.completedAt = null;
    f.run.status = 'draft';
    f.ctx.request.body.data.expiresAt = '2999-01-01T00:00:00.000Z';
    await f.invoke('expiration');
    assert.equal(f.session.status, locked ? 'expired' : 'active');
    assert.equal(f.session.completionLocked, locked);
    assert.equal(f.run.status, 'draft');
    assert.equal(f.writes.length, 1);
  });
}

for (const status of ['active', 'completed', 'expired']) {
  test(`status read projects overdue ${status} without exposing link or mutating persisted state`, async () => {
    const f = fixture();
    f.session.status = status;
    f.session.expiresAt = '2020-01-01T00:00:00.000Z';
    if (status === 'active') { f.session.completedAt = null; f.session.completionLocked = false; }
    await f.invoke('status');
    assert.equal(f.ctx.body.data.status, status === 'active' ? 'expired' : 'completed');
    assert.equal(f.ctx.body.data.publicUrl, null);
    assert.equal(f.session.status, status);
    assert.equal(f.writes.length, 0);
  });
}

test('reopening uses the existing editable run status without a schema migration', async () => {
  const f = fixture();
  await f.invoke('reopen');
  assert.equal(f.run.status, 'draft');
  assert.equal(f.ctx.body.data.testRun.status, 'draft');
  const schema = JSON.parse(readFileSync('src/api/test-run/content-types/test-run/schema.json', 'utf8'));
  assert.deepEqual(schema.attributes.status.enum, ['draft', 'final']);
  const types = readFileSync('types/generated/contentTypes.d.ts', 'utf8');
  const runTypes = types.split('export interface ApiTestRunTestRun ')[1].split('export interface ')[0];
  assert.match(runTypes, /Enumeration<\['draft', 'final'\]>/);
});

for (const action of ['reopen', 'expiration']) {
  for (const role of ['owner', 'qa-lead', 'qa-engineer', 'manager', 'viewer', 'foreign-owner', 'anonymous']) {
    test(`actual ${action} route, tenant policy and handler enforce ${role} access`, async () => {
      const f = fixture();
      f.setRole(role === 'foreign-owner' ? 'owner' : role);
      f.ctx.request.body.data.expiresAt = '2999-01-01T00:00:00.000Z';
      if (role === 'foreign-owner') f.run.organization = { documentId: 'foreign-org' };
      if (role === 'anonymous') f.ctx.state.user = null;
      if (['owner', 'qa-lead'].includes(role)) {
        await f.invoke(action, f.ctx, true);
        assert.equal(f.ctx.body.data.documentId, f.session.documentId);
      } else {
        await assert.rejects(f.invoke(action, f.ctx, true), { name: role === 'anonymous' ? 'UnauthorizedError' : 'ForbiddenError' });
        assert.equal(f.writes.length, 0);
      }
    });
  }
}

for (const invalid of ['draft', 'unpublished', 'missing-token']) {
  test(`expiration editing requires an existing published session (${invalid})`, async () => {
    const f = fixture();
    f.ctx.request.body.data.expiresAt = '2999-01-01T00:00:00Z';
    if (invalid === 'draft') f.session.status = 'draft';
    if (invalid === 'unpublished') f.session.activatedAt = null;
    if (invalid === 'missing-token') f.session.tokenHash = null;
    await assert.rejects(f.invoke('expiration'), { name: 'ValidationError' });
    assert.equal(f.writes.length, 0);
  });
}

test('expired lifecycle state without a stored deadline still requires a new future deadline', async () => {
  const f = fixture();
  f.session.status = 'expired';
  f.session.expiresAt = null;
  await assert.rejects(f.invoke('reopen'), { name: 'ValidationError' });
  assert.equal(f.writes.length, 0);
});

for (const action of ['reopen', 'expiration']) {
  for (const failure of ['session', 'readback', 'transaction', ...(action === 'reopen' ? ['run'] : [])]) {
    test(`${action} leaves both records unchanged on ${failure} failure and publishes no success DTO`, async () => {
      const f = fixture();
      f.ctx.request.body.data.expiresAt = '2999-02-01T00:00:00Z';
      const before = structuredClone(f.session);
      if (failure === 'session') f.failSession();
      if (failure === 'readback') f.failReadback();
      if (failure === 'transaction') f.failTransaction();
      if (failure === 'run') f.failRun();
      await assert.rejects(f.invoke(action), new RegExp(`synthetic ${failure}`));
      assert.deepEqual(f.session, before);
      assert.equal(f.run.status, 'final');
      assert.equal(f.ctx.body, undefined);
    });
  }
}

test('repeated reopen of now-active session is rejected without additional effects', async () => {
  const f = fixture();
  await f.invoke('reopen');
  const count = f.writes.length;
  await assert.rejects(f.invoke('reopen'), { name: 'ValidationError' });
  assert.equal(f.writes.length, count);
});

test('reopen reads fresh lifecycle after locking rather than overwriting a concurrent revocation', async () => {
  const f = fixture();
  f.onSessionLock(() => { f.session.status = 'revoked'; });
  await assert.rejects(f.invoke('reopen'), { name: 'ValidationError' });
  assert.equal(f.writes.length, 0);
});

for (const status of ['expired', 'active']) {
  test(`explicit reopening supports ${status} locked published sessions`, async () => {
    const f = fixture();
    f.session.status = status;
    f.ctx.request.body.data.expiresAt = '2999-02-01T00:00:00Z';
    await f.invoke('reopen');
    assert.equal(f.session.status, 'active');
    assert.equal(f.session.completionLocked, false);
    assert.equal(f.ctx.body.data.testRun.status, 'draft');
  });
}

for (const expiresAt of [undefined, null, '', '2999-02-29T00:00:00Z', '3000-02-29T00:00:00Z', '2999-04-31T00:00:00Z', '2999-01-01', '2999-01-01T00:00:00', '2020-01-01T00:00:00Z', {}, 99999999999999]) {
  test(`expiration edit rejects invalid deadline without writes: ${String(expiresAt)}`, async () => {
    const f = fixture();
    f.ctx.request.body.data.expiresAt = expiresAt;
    await assert.rejects(f.invoke('expiration'), { name: 'ValidationError' });
    assert.equal(f.writes.length, 0);
  });
}

test('valid leap-day expiration normalizes its explicit offset', async () => {
  const f = fixture();
  f.ctx.request.body.data.expiresAt = '2996-02-29T00:15:00+01:00';
  await f.invoke('expiration');
  assert.equal(f.ctx.body.data.expiresAt, '2996-02-28T23:15:00.000Z');
});

test('expiration rejects incoherent relations using the same handler preflight as reopening', async () => {
  const f = fixture();
  f.session.project = { documentId: 'foreign-project' };
  f.ctx.request.body.data.expiresAt = '2999-02-01T00:00:00Z';
  await assert.rejects(f.invoke('expiration'), { name: 'ForbiddenError' });
  assert.equal(f.writes.length, 0);
});

test('100% answered reopened UAT remains editable and can explicitly finalize again with fresh run status', async () => {
  const f = fixture();
  const results = structuredClone(f.run.results);
  await f.invoke('reopen');
  const publicCtx: any = { params: { token: f.token }, request: { body: { data: {} } } };
  await f.invoke('publicSession', publicCtx);
  assert.equal(publicCtx.body.data.session.readOnly, false);
  assert.equal(publicCtx.body.data.testRun.status, 'draft');
  assert.deepEqual(f.run.results, results);
  await f.invoke('completePublicSession', publicCtx);
  assert.equal(f.run.status, 'final');
  assert.equal(f.session.status, 'completed');
  assert.equal(f.session.completionLocked, true);
  assert.ok(f.session.completedAt);
  assert.equal(publicCtx.body.data.testRun.status, 'final');
  assert.deepEqual(f.run.results, results);
  const count = f.writes.length;
  await assert.rejects(f.invoke('completePublicSession', publicCtx), { name: 'ForbiddenError' });
  assert.equal(f.writes.length, count);
});

test('reopen rejects a stale document snapshot when the locked SQL row is already revoked', async () => {
  const f = fixture();
  // MySQL REPEATABLE READ may retain an earlier document-service read view after waiting for a lock.
  f.setLockedSessionStatus('revoked');
  await assert.rejects(f.invoke('reopen'), { name: 'ValidationError' });
  assert.equal(f.writes.length, 0);
});

for (const action of ['reopen', 'expiration']) {
  test(`${action} rejects stale same-status document reads after a competing lifecycle write`, async () => {
    const f = fixture();
    f.ctx.request.body.data.expiresAt = '2999-02-01T00:00:00Z';
    f.setLockedSessionUpdatedAt('2026-05-02T00:00:00.000Z');
    await assert.rejects(f.invoke(action), { name: 'ValidationError' });
    assert.equal(f.writes.length, 0);
  });
}

test('expiration extension retains a historically expired completion as a completed read-only receipt', async () => {
  const f = fixture();
  f.session.status = 'expired';
  f.session.expiresAt = '2020-01-01T00:00:00.000Z';
  const completedAt = f.session.completedAt;
  f.ctx.request.body.data.expiresAt = '2999-02-01T00:00:00Z';
  await f.invoke('expiration');
  assert.equal(f.ctx.body.data.status, 'completed');
  assert.equal(f.session.status, 'completed');
  assert.equal(f.session.completionLocked, true);
  assert.equal(f.session.completedAt, completedAt);
  assert.equal(f.run.status, 'final');
  const publicCtx: any = { params: { token: f.token } };
  await f.invoke('publicSession', publicCtx);
  assert.equal(publicCtx.body.data.session.readOnly, true);
});

test('status projection never exposes an expired-state bearer link before a lifecycle action restores it', async () => {
  const f = fixture();
  f.session.status = 'expired';
  await f.invoke('status');
  assert.equal(f.ctx.body.data.status, 'completed');
  assert.equal(f.ctx.body.data.publicUrl, null);
  assert.equal(f.writes.length, 0);
});

test('reopen completed UAT retains its link, identity, permissions and every saved response', async () => {
  const f = fixture();
  const before = structuredClone(f.session);
  await f.invoke('reopen');
  assert.equal(f.session.status, 'active');
  assert.equal(f.session.completionLocked, false);
  assert.equal(f.session.completedAt, null);
  assert.equal(f.run.status, 'draft');
  assert.equal(f.ctx.body.data.testRun.status, 'draft');
  assert.ok(f.ctx.body.data.publicUrl.endsWith(encodeURIComponent(f.token)));
  for (const key of ['activatedAt', 'tokenHash', 'participantNameSnapshot', 'participantEmailSnapshot', 'externalParticipant', 'allowResultEditing', 'allowCommentEditing', 'allowEvidenceUpload', 'deliveryNotes']) {
    assert.deepEqual(f.session[key], before[key], key);
  }
  assert.deepEqual(f.run.results, before.testRun.results);
  assert.equal(f.transactions, 1);
  assert.ok(f.writes.every(write => write.tx));
  assert.equal(f.locks.length, 2);
});
