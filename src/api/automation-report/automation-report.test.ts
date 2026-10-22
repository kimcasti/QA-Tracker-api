import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import net from 'node:net';
import routes from './routes/automation-report';
import controller from './controllers/automation-report';
import service from './services/automation-report';
import session from '../../policies/automation-session';
import { READ_ROLES } from '../../utils/access';

const require = createRequire(import.meta.url);
const registryFactory = require(resolve('node_modules/@strapi/core/dist/registries/policies.js'));
const runUid = 'api::test-run.test-run';
const memberUid = 'api::organization-membership.organization-membership';
const invitationUid = 'api::organization-invitation.organization-invitation';
const jobUid = 'api::automation-job.automation-job';
const membership = (role = 'viewer', org = 'org') => ({ documentId: `m-${org}-${role}`, isActive: true,
  organization: { documentId: org, status: 'active' }, organizationRole: { code: role } });
const persistedRun = () => ({ documentId: 'run', organization: { documentId: 'org' },
  project: { documentId: 'project', organization: { documentId: 'org' } } });
const job = (id: number, changes = {}) => ({ id, runId: 'run', projectId: 'project', state: 'completed',
  finishedAt: id === 1 ? null : '2026-10-19T12:00:00.000Z', completedCount: 1,
  cases: [{ caseId: 'case', resultId: 'result', reference: 'ref', title: 'private', catalog: 'private' }],
  outcomes: [{ automationReference: 'ref', status: 'passed', notes: 'private', evidenceImage: 'private' }],
  requestKey: 'private', receiptHash: 'private', session: 'private', catalog: 'private', tokens: 'private', ...changes });

function fixture(options: any = {}) {
  const calls: any[] = [];
  const members = options.members ?? [membership(options.role)];
  const rows = options.jobs ?? [job(1)];
  const run = options.run === undefined ? persistedRun() : options.run;
  const effects: string[] = [];
  const forbidden = (name: string) => () => { effects.push(name); assert.fail(`Forbidden side effect: ${name}`); };
  const writes = Object.fromEntries(['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'publish', 'unpublish', 'discardDraft'].map(k => [k, forbidden(k)]));
  const api: any = {
    plugin: (name: string) => { assert.equal(name, 'users-permissions'); return { service: (name: string) => {
      assert.equal(name, 'jwt'); return { verify: async (token: string) => {
        calls.push(['jwt', token]); if (token !== 'valid') throw new Error('Invalid JWT'); return options.claims ?? { id: 7 };
      } };
    } }; },
    service: forbidden('service'),
    db: { transaction: forbidden('transaction'), connection: forbidden('connection'), query: (uid: string) => {
      if (uid === 'plugin::users-permissions.user') return { ...writes, findOne: async () => ({ id: 7,
        email: 'reader@example.invalid', confirmed: options.confirmed ?? true, blocked: options.blocked ?? false }) };
      assert.equal(uid, jobUid, `Unexpected DB access: ${uid}`);
      return { ...writes, findWithCount: async (query: any) => {
        calls.push(['jobs', query]);
        const filtered = rows.filter((r: any) => Object.entries(query.where).every(([key, val]) => r[key] === val));
        assert.deepEqual(query.orderBy, { id: 'asc' });
        const ordered = [...filtered].sort((a: any, b: any) => a.id - b.id);
        return [ordered.slice(query.offset, query.offset + query.limit), ordered.length];
      } };
    } },
    documents: (uid: string) => ({ ...writes,
      findMany: async (query: any) => {
        calls.push([uid, 'findMany', query]);
        if (uid === memberUid) {
          assert.equal(query.filters.user.id, 7); assert.equal(query.filters.isActive, true);
          assert.equal(query.filters.organization.status, 'active'); return members;
        }
        assert.equal(uid, invitationUid);
        assert.equal(query.filters.email, 'reader@example.invalid'); assert.equal(query.filters.status, 'accepted');
        return (options.assigned === false ? [] : [{ workspaceProjectDocumentIds: ['project'] }]);
      },
      findFirst: async () => { calls.push([uid, 'findFirst']); return null; },
      findOne: async (query: any) => {
        calls.push([uid, 'findOne', query]); assert.equal(uid, runUid); assert.equal(query.documentId, 'run'); return run;
      },
    }),
  };
  (globalThis as any).strapi = api;
  return { api, effects, calls };
}

async function dispatch(options: any = {}, query: any = {}) {
  const f = fixture(options);
  const route = routes.routes[0];
  const ctx: any = { state: {}, params: { documentId: 'run' }, query,
    request: { method: 'GET', headers: { authorization: `Bearer ${options.token ?? 'valid'}` } } };
  // Resolve the actual route through the installed framework, not a rewritten authorization check.
  const registry = registryFactory();
  registry.set('global::automation-session', session);
  const readPolicy = (await import('./policies/tenant-access')).default;
  registry.set('api::automation-report.tenant-access', readPolicy);
  const policies = registry.resolve(route.config.policies, { apiName: 'automation-report' });
  try {
    for (const { handler, config } of policies) assert.equal(await handler(ctx, config, { strapi: f.api }), true);
    await controller.jobs(ctx);
    return { ...f, ctx };
  } finally {
    assert.deepEqual(f.effects, []);
  }
}

 test('route config uses user JWT and real tenant-access semantics for the persisted run', () => {
  const route = routes.routes[0];
  assert.equal(routes.routes.length, 1);
  assert.equal(route.method, 'GET'); assert.equal(route.path, '/test-runs/:documentId/automation-report-jobs');
  assert.equal(route.handler, 'automation-report.jobs'); assert.equal(route.config.auth, false);
  assert.equal(route.config.policies[0], 'global::automation-session');
  const policy: any = route.config.policies[1];
  assert.equal(policy.name, 'api::automation-report.tenant-access');
  assert.deepEqual(policy.config, { contentTypeUid: runUid, allowedRoles: READ_ROLES });
});

test('assigned viewer reads the persisted nullable date and only explicit minimal fields', async () => {
  const { ctx, calls } = await dispatch({}, { page: '1', pageSize: '100', projectId: 'caller-foreign', populate: '*' });
  assert.deepEqual(ctx.body, { data: { jobs: [{ id: 1, runId: 'run', state: 'completed', finishedAt: null,
    completedCount: 1, cases: [{ caseId: 'case', resultId: 'result', reference: 'ref' }],
    outcomes: [{ automationReference: 'ref', status: 'passed' }] }], pagination: { page: 1, pageSize: 100, total: 1, pageCount: 1 } } });
  const dbQuery = calls.find(call => call[0] === 'jobs')[1];
  assert.deepEqual(dbQuery.where, { runId: 'run', projectId: 'project', state: 'completed' });
  assert.deepEqual(dbQuery.select, ['id', 'runId', 'state', 'finishedAt', 'completedCount', 'cases', 'outcomes']);
});

test('non-array persisted JSON cannot escape the minimal report DTO', async () => {
  for (const value of [undefined, null, 'PRIVATE_JSON_MUST_NOT_LEAK', { session: 'PRIVATE_JSON_MUST_NOT_LEAK' }]) {
    const { ctx } = await dispatch({ jobs: [job(1, { cases: value, outcomes: value })] });
    assert.deepEqual(ctx.body.data.jobs[0].cases, []);
    assert.deepEqual(ctx.body.data.jobs[0].outcomes, []);
    assert.equal(JSON.stringify(ctx.body).includes('PRIVATE_JSON_MUST_NOT_LEAK'), false);
  }
});

test('completed jobs paginate beyond 100 without including foreign or unfinished jobs', async () => {
  const rows = Array.from({ length: 137 }, (_, index) => job(index + 1));
  rows.push(job(201, { projectId: 'foreign-project' }), job(202, { runId: 'foreign-run' }),
    job(203, { state: 'running' }), job(204, { state: 'interrupted' }));
  const first = await dispatch({ jobs: rows }, { page: '1', pageSize: '100' });
  const second = await dispatch({ jobs: rows }, { page: '2', pageSize: '100' });
  assert.equal(first.ctx.body.data.jobs.length, 100);
  assert.equal(second.ctx.body.data.jobs.length, 37);
  assert.deepEqual(second.ctx.body.data.pagination, { page: 2, pageSize: 100, total: 137, pageCount: 2 });
  assert.deepEqual(second.ctx.body.data.jobs.map((item: any) => item.id), Array.from({ length: 37 }, (_, index) => index + 101));
  assert.equal(new Set([...first.ctx.body.data.jobs, ...second.ctx.body.data.jobs].map((item: any) => item.id)).size, 137);
});

test('a persisted run cannot use an organization different from its project', async () => {
  await assert.rejects(dispatch({ role: 'owner', run: {
    documentId: 'run', organization: { documentId: 'org' },
    project: { documentId: 'foreign-project', organization: { documentId: 'foreign-org' } },
  }, jobs: [job(1, { projectId: 'foreign-project' })] }), /organizaci[oó]n|coheren/i);
});

for (const role of READ_ROLES) {
  test(`read-only report permits the ${role} reader in the target project`, async () => {
    const result = await dispatch({ role });
    assert.equal(result.ctx.body.data.jobs.length, 1);
    assert.deepEqual(result.effects, []);
  });
}

for (const role of ['viewer', 'manager']) {
  test(`an unassigned ${role} cannot read automation jobs`, async () => {
    await assert.rejects(dispatch({ role, assigned: false }), /assigned|access|project/i);
  });
}

for (const [label, options] of [
  ['invalid token', { token: 'invalid' }], ['blocked user', { blocked: true }],
  ['unconfirmed user', { confirmed: false }], ['invalid subject', { claims: { id: 0 } }],
  ['missing membership', { members: [] }], ['foreign tenant', { members: [membership('owner', 'foreign-org')] }],
  ['foreign owner cannot upgrade target viewer', { members: [membership('owner', 'foreign-org'), membership('viewer')], assigned: false }],
] as const) {
  test(`report rejects ${label} without side effects`, async () => {
    await assert.rejects(dispatch(options));
  });
}

test('report validates page values and safe offsets', async () => {
  for (const query of [{ page: '0' }, { page: '-1' }, { page: '1.5' }, { page: '1e2' },
    { page: [] }, { page: {} }, { page: true }, { page: '' }, { pageSize: '0' },
    { pageSize: '101' }, { pageSize: [] }, { page: String(Number.MAX_SAFE_INTEGER), pageSize: '100' }]) {
    await assert.rejects(dispatch({}, query), /paginaci[oó]n|paginaci|pagination/i);
  }
  const result = await dispatch({ jobs: [] }, { page: '1', pageSize: '20' });
  assert.deepEqual(result.ctx.body.data.pagination, { page: 1, pageSize: 20, total: 0, pageCount: 0 });
});

test('missing run is rejected and direct service still checks authorization', async () => {
  await assert.rejects(dispatch({ run: null }));
  const f = fixture({ members: [membership('owner', 'foreign-org')] });
  await assert.rejects(service.jobs({ state: { user: { id: 7, email: 'reader@example.invalid' } },
    params: { documentId: 'run' }, query: {}, request: { method: 'GET' } }));
  assert.deepEqual(f.effects, []);
  assert.equal(f.calls.filter(call => call[0] === 'jobs').length, 0);
});

test('read-only automation report route and handler exist', () => {
  for (const path of ['routes/automation-report.ts', 'controllers/automation-report.ts', 'services/automation-report.ts']) {
    assert.ok(existsSync(resolve('src/api/automation-report', path)), `Missing report contract implementation: ${path}`);
  }
});
