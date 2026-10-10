import assert from 'node:assert/strict';
import { test } from 'node:test';
import service from './automation-runner';
import { catalogInput, digest, referenceProblem, validateOutcomes } from './protocol';
import catalogService from '../../automation-catalog/services/automation-catalog';

const refs = ['users/list.spec.ts::buscar', 'patients/list.spec.ts::crear'];
test('references are exact, duplicates are rejected and results cannot escape the selection', () => {
  assert.equal(referenceProblem(refs[0], refs, refs), null);
  assert.ok(referenceProblem(refs[0].toUpperCase(), refs, refs));
  assert.ok(referenceProblem(refs[0], [...refs, refs[0]], refs));
  assert.ok(referenceProblem(refs[0], refs, [...refs, refs[0]]));
  assert.throws(() => catalogInput(['a\n::b']));
  const cases = refs.map((reference, i) => ({ reference, resultId: 'r' + i, caseId: 'c' + i, title: 'Test' }));
  assert.throws(() => validateOutcomes([{ automationReference: refs[0], status: 'passed' }], cases));
  assert.throws(() => validateOutcomes(refs.map(() => ({ automationReference: refs[0], status: 'passed' })), cases));
  assert.throws(() => validateOutcomes(refs.map(automationReference => ({ automationReference, status: 'passed', evidenceImage: '<script>' })), cases));
});

// In-memory adapter with serialized transactions and rollback; no external database writes.
function fixture() {
  let store: any = {
    connections: [{ id: 1, projectId: 'project', label: 'Equipo', state: 'active', expiresAt: '2099-01-01' }],
    runners: [], jobs: [], catalogs: [], projects: [{ id: 4, documentId: 'project' }],
    project: { documentId: 'project', organization: { documentId: 'org' } },
    cases: refs.map((reference, i) => ({ documentId: 'c' + i, title: 'Caso ' + i, automationStatus: 'automated',
      automationTool: 'playwright', automationReference: reference, project: { documentId: 'project' } })),
    memberships: [{ documentId: 'membership', isActive: true, organization: { documentId: 'org', status: 'active' }, organizationRole: { code: 'owner' } }],
    results: [{ documentId: 'r0', result: 'not_executed', notes: 'old' }, { documentId: 'r1', result: 'not_executed' },
      { documentId: 'manual', result: 'passed', notes: 'Manual preserved', evidenceImage: 'manual.png', bugTitle: 'Manual bug' }],
    writes: 0,
  };
  const run = () => ({ id: 5, documentId: 'run', status: 'draft', project: store.project,
    results: store.results.map((row: any, i: number) => ({ ...row, testCase: store.cases[i] })) });
  const matches = (row: any, query: any): boolean => Object.entries(query || {}).every(([key, value]: any) => {
    if (key === '$or') return value.some((part: any) => matches(row, part));
    if (value && typeof value === 'object') {
      if ('$in' in value) return value.$in.includes(row[key]);
      if ('$gt' in value) return row[key] > value.$gt;
      if ('$lt' in value) return row[key] < value.$lt;
    }
    return row[key] === value;
  });
  let queue = Promise.resolve();
  const strapi = {
    db: {
      metadata: { get: (uid: string) => ({ tableName: uid }) },
      transaction: async (work: any) => {
        const previous = queue; let release!: () => void;
        queue = new Promise(resolve => { release = resolve; });
        await previous;
        const snapshot = structuredClone(store);
        try {
          const trx = () => ({ where: () => ({ forUpdate: () => ({ first: async () => ({}) }) }),
            whereIn: () => ({ forUpdate: async () => [] }) });
          return await work({ trx });
        } catch (error) { store = snapshot; throw error; }
        finally { release(); }
      },
      query: (uid: string) => {
        const key = uid.includes('automation-connection') ? 'connections' : uid.includes('automation-runner') ? 'runners'
          : uid.includes('automation-catalog') ? 'catalogs' : uid.includes('api::project.') ? 'projects' : 'jobs';
        return {
          findOne: async ({ where }: any) => store[key].find((r: any) => matches(r, where)) || null,
          findMany: async ({ where, orderBy, limit }: any) => {
            const rows = store[key].filter((r: any) => matches(r, where));
            if (orderBy?.id === 'desc') rows.reverse();
            return rows.slice(0, limit || rows.length);
          },
          findWithCount: async ({ where, orderBy, limit }: any) => {
            const rows = store[key].filter((r: any) => matches(r, where));
            if (orderBy?.id === 'desc') rows.reverse();
            return [rows.slice(0, limit || rows.length), rows.length];
          },
          create: async ({ data }: any) => {
            for (const field of key === 'jobs' ? ['activeRun', 'activeRunner', 'requestKey'] : key === 'catalogs' ? ['activeRunner', 'requestKey'] : ['connectionId']) {
              if (data[field] != null && store[key].some((r: any) => r[field] === data[field])) throw new Error('Unique violation');
            }
            const row = { id: store[key].length + 1, ...data };
            store[key].push(row); return row;
          },
          update: async ({ where, data }: any) => {
            const row = store[key].find((r: any) => matches(r, where));
            Object.assign(row, data); return row;
          },
          updateMany: async ({ where, data }: any) => {
            const rows = store[key].filter((r: any) => matches(r, where));
            rows.forEach((r: any) => Object.assign(r, data)); return { count: rows.length };
          },
        };
      },
    },
    documents: (uid: string) => ({
      findFirst: async () => store.project,
      findOne: async () => run(),
      findMany: async () => uid.includes('membership') ? store.memberships : uid.includes('test-case') ? store.cases : [],
      update: async ({ documentId, data }: any) => {
        store.writes++;
        if (store.failWriteAt === store.writes) throw new Error('Simulated write failure');
        const collection = uid.includes('test-run-result') ? store.results : store.cases;
        const row = collection.find((item: any) => item.documentId === documentId);
        Object.assign(row, data); return row;
      },
    }),
  };
  (globalThis as any).strapi = strapi;
  const ctx = (data = {}) => ({ state: { user: { id: 1 }, automationConnection: store.connections[0] },
    params: { runId: 'run' }, request: { body: { data: { session: 'session', ...data } } } });
  const register = () => service.register(ctx({ catalog: refs }));
  const enqueue = (data = {}) => {
    const context = ctx({ runnerId: 1, requestId: 'request', caseIds: ['c0', 'c1'], ...data });
    delete context.request.body.data.session;
    return service.enqueue(context);
  };
  return { ctx, register, enqueue, state: () => store };
}

const catalogCtx = (f: ReturnType<typeof fixture>, data = {}, requestId = 1) => ({
  ...f.ctx(), request: { body: { data } }, params: { projectKey: 'p', requestId: String(requestId) },
});
async function completedCatalog(f: ReturnType<typeof fixture>, references = ['new.spec.ts::iniciar sesión', 'new.spec.ts::salir']) {
  await service.register(f.ctx({ catalog: refs, catalogRefreshVersion: 1, environments: ['local', 'test'] }));
  const request = await catalogService.request(catalogCtx(f, { runnerId: 1, requestId: 'catalog', environment: 'test' }));
  const heartbeat = await service.poll(f.ctx({ claim: false }));
  assert.equal(heartbeat.catalogRequest, undefined);
  const claimed = await service.poll(f.ctx({ claim: true }));
  assert.equal(claimed.catalogRequest.id, request.id);
  await service.completeCatalog(f.ctx({ catalogRequestId: request.id, references }));
  return catalogService.details(catalogCtx(f));
}

test('catalog detection is idempotent, exact, independent of test runs and supports empty inventories', async () => {
  const f = fixture();
  const result = await completedCatalog(f, []);
  assert.equal(result.state, 'completed');
  assert.deepEqual(result.references, []);
  assert.equal(f.state().writes, 0);
  assert.equal(f.state().jobs.length, 0);
  const retried = await service.completeCatalog(f.ctx({ catalogRequestId: 1, references: [] }));
  assert.equal(retried.state, 'completed');
  const repeated = await catalogService.request(catalogCtx(f, { runnerId: 1, requestId: 'catalog', environment: 'test' }));
  assert.equal(repeated.id, 1);
  assert.equal(f.state().catalogs.length, 1);
});

test('old, offline and busy runners cannot discover; discovery excludes execution enqueues', async () => {
  const f = fixture();
  await f.register();
  const request = () => catalogService.request(catalogCtx(f, { runnerId: 1, requestId: 'catalog', environment: 'local' }));
  await assert.rejects(request(), /Actualiza/);
  f.state().runners[0].catalogRefreshVersion = 1;
  f.state().runners[0].lastSeenAt = '1970-01-01';
  await assert.rejects(request(), /desconectado/);
  f.state().runners[0].lastSeenAt = new Date().toISOString();
  await f.enqueue();
  await assert.rejects(request(), /ocupado/);
  f.state().jobs[0].activeRunner = null;
  f.state().jobs[0].activeRun = null;
  f.state().jobs[0].state = 'completed';
  await request();
  await assert.rejects(f.enqueue({ requestId: 'other' }), /detectando/);
});

test('catalog failures and expiration release the runner without modifying results', async () => {
  const f = fixture();
  await service.register(f.ctx({ catalog: refs, catalogRefreshVersion: 1 }));
  await catalogService.request(catalogCtx(f, { runnerId: 1, requestId: 'catalog', environment: 'local' }));
  await service.poll(f.ctx({ claim: true }));
  await service.completeCatalog(f.ctx({ catalogRequestId: 1, error: 'Script error' }));
  assert.equal(f.state().catalogs[0].state, 'failed');
  assert.equal(f.state().catalogs[0].activeRunner, null);
  await catalogService.request(catalogCtx(f, { runnerId: 1, requestId: 'again', environment: 'local' }));
  f.state().catalogs[1].requestedAt = '1970-01-01';
  await service.sweep();
  assert.equal(f.state().catalogs[1].state, 'failed');
  assert.equal(f.state().writes, 0);
});

test('reviewed assignments preserve content, set automation fields, clear stale metadata and retry idempotently', async () => {
  const f = fixture();
  Object.assign(f.state().cases[0], { automationStatus: 'not_automated', automationTool: null,
    automationType: 'api', description: 'preserved', automationOwner: 'Kimberly', sortOrder: 7,
    lastAutomationStatus: 'passed', lastAutomationRunAt: '2026-01-01' });
  const catalog = await completedCatalog(f);
  const data = { requestId: 'assign', catalogHash: catalog.catalogHash, assignments: [
    { caseId: 'c0', reference: catalog.references[0], snapshot: catalog.cases[0].snapshot },
  ] };
  await catalogService.assign(catalogCtx(f, data));
  const item = f.state().cases[0];
  assert.equal(item.automationStatus, 'automated');
  assert.equal(item.isAutomated, true);
  assert.equal(item.automationTool, 'playwright');
  assert.equal(item.automationType, 'api');
  assert.equal(item.description, 'preserved');
  assert.equal(item.automationOwner, 'Kimberly');
  assert.equal(item.sortOrder, 7);
  assert.equal(item.lastAutomationStatus, 'unknown');
  assert.equal(item.lastAutomationRunAt, null);
  await catalogService.assign(catalogCtx(f, data));
  assert.equal(f.state().writes, 1);
  assert.equal(f.state().catalogs[0].assignmentReceipts.length, 1);
});

test('stale selections and references owned by manual/obsolete cases reject the entire batch', async () => {
  const f = fixture();
  const catalog = await completedCatalog(f);
  const data = { requestId: 'assign', catalogHash: catalog.catalogHash, assignments: [
    { caseId: 'c0', reference: catalog.references[0], snapshot: catalog.cases[0].snapshot },
    { caseId: 'c1', reference: catalog.references[1], snapshot: catalog.cases[1].snapshot },
  ] };
  f.state().cases[1].updatedAt = '2026-10-08';
  await assert.rejects(catalogService.assign(catalogCtx(f, data)), /cambió/);
  assert.equal(f.state().writes, 0);
  delete f.state().cases[1].updatedAt;
  f.state().cases.push({ documentId: 'manual', automationStatus: 'obsolete', automationReference: catalog.references[0] });
  await assert.rejects(catalogService.assign(catalogCtx(f, data)), /otro caso/);
  assert.equal(f.state().writes, 0);
});

test('assignments roll back all writes when a later write fails', async () => {
  const f = fixture();
  const catalog = await completedCatalog(f);
  f.state().failWriteAt = 2;
  await assert.rejects(catalogService.assign(catalogCtx(f, { requestId: 'assign', catalogHash: catalog.catalogHash,
    assignments: catalog.cases.map((item, i) => ({ caseId: item.id, reference: catalog.references[i], snapshot: item.snapshot })) })), /Simulated/);
  assert.equal(f.state().writes, 0);
  assert.deepEqual(f.state().cases.map(item => item.automationReference), refs);
  assert.equal(f.state().catalogs[0].assignmentReceipts.length, 0);
});

test('catalog access checks membership and hides another project request; duplicates and casing are exact', async () => {
  const f = fixture();
  const catalog = await completedCatalog(f, ['A.spec.ts::test', 'A.spec.ts::test', 'a.spec.ts::test']);
  const data = { requestId: 'assign', catalogHash: catalog.catalogHash,
    assignments: [{ caseId: 'c0', reference: 'A.spec.ts::test', snapshot: catalog.cases[0].snapshot }] };
  await assert.rejects(catalogService.assign(catalogCtx(f, data)), /ambigua/);
  data.assignments[0].reference = 'a.spec.ts::test';
  await catalogService.assign(catalogCtx(f, data));
  f.state().catalogs[0].projectId = 'other';
  await assert.rejects(catalogService.details(catalogCtx(f)), /no encontrada/);
  f.state().memberships[0].organizationRole.code = 'viewer';
  await assert.rejects(catalogService.connections(catalogCtx(f)), /engineering/);
});

test('inspection counts only jobs for the current run and project beyond the history limit', async () => {
  const f = fixture();
  f.state().jobs = Array.from({ length: 25 }, (_, index) => ({
    id: 100 + index * 3, runId: 'run', projectId: 'project', state: 'completed', cases: [],
  }));
  f.state().jobs.push(
    { id: 200, runId: 'other-run', projectId: 'project', state: 'completed', cases: [] },
    { id: 201, runId: 'run', projectId: 'other-project', state: 'completed', cases: [] },
  );
  const inspection = await service.inspect(f.ctx());
  assert.equal(inspection.totalJobs, 25);
  assert.equal(inspection.jobs.length, 20);
  assert.equal(inspection.jobs[0].id, 172);
  assert.equal(inspection.jobs[19].id, 115);
});

test('mixed modules, double click, atomic claim, selected-only publication and idempotent resend', async () => {
  const f = fixture(); await f.register();
  const [a, b] = await Promise.all([f.enqueue(), f.enqueue()]);
  assert.equal(a.id, b.id); assert.equal(f.state().jobs.length, 1);
  const claims = await Promise.all([service.poll(f.ctx({ claim: true })), service.poll(f.ctx({ claim: true }))]);
  assert.equal(claims.filter(c => c.claimed).length, 1);
  const manual = structuredClone(f.state().results[2]);
  const results = refs.map(automationReference => ({ automationReference, status: 'passed', notes: 'OK' }));
  const complete = () => service.complete(f.ctx({ jobId: a.id, results }));
  await Promise.all([complete(), complete()]);
  assert.equal(f.state().writes, 4);
  assert.deepEqual(f.state().results[2], manual);
  assert.equal(f.state().jobs[0].state, 'completed');
  assert.equal(f.state().jobs[0].activeRun, null);
  await assert.rejects(service.complete(f.ctx({ jobId: a.id, results: results.map(r => ({ ...r, status: 'failed' })) })), /otros resultados/);
});

test('invalid references, offline runner, other organization and busy runner are rejected', async () => {
  const f = fixture(); await f.register();
  f.state().cases[0].automationReference = 'missing';
  await assert.rejects(f.enqueue(), /inválida/);
  f.state().cases[0].automationReference = refs[0];
  f.state().runners[0].lastSeenAt = '2000-01-01';
  await assert.rejects(f.enqueue(), /desconectado/);
  f.state().runners[0].lastSeenAt = new Date().toISOString();
  await f.enqueue();
  await assert.rejects(f.enqueue({ requestId: 'different' }), /activo/);
  f.state().project.organization.documentId = 'other';
  await assert.rejects(service.inspect(f.ctx()), /Cross-organization/);
});

test('disconnect interrupts without requeue; delayed reports can publish but never overwrite a newer job', async () => {
  const f = fixture(); await f.register(); const job = await f.enqueue();
  await service.poll(f.ctx({ claim: true }));
  f.state().runners[0].lastSeenAt = '2000-01-01';
  await service.sweep();
  assert.equal(f.state().jobs[0].state, 'interrupted');
  assert.equal((await service.poll(f.ctx({ claim: true }))).job, null);
  await f.enqueue({ requestId: 'new' });
  const results = refs.map(automationReference => ({ automationReference, status: 'passed' }));
  await assert.rejects(service.complete(f.ctx({ jobId: job.id, results })), /cambió/);
  assert.equal(f.state().writes, 0);
});

test('registration rejects a second live process and results are bound to the runner session', async () => {
  const f = fixture(); await f.register();
  await assert.rejects(service.register(f.ctx({ catalog: refs, session: 'different' })), /activo/);
  assert.equal(f.state().runners[0].sessionHash, digest('session'));
  await assert.rejects(service.poll(f.ctx({ session: 'wrong' })), /inválida/);
});

test('inspection lists project connections without runners and keeps independent live runners selectable', async () => {
  const f = fixture();
  f.state().connections[0].userId = 2;
  f.state().connections.push(
    { id: 2, userId: 1, projectId: 'project', label: 'Mi equipo', state: 'active', expiresAt: '2099-01-01' },
    { id: 3, userId: 1, projectId: 'other', label: 'Otro proyecto', state: 'active', expiresAt: '2099-01-01' },
    { id: 4, userId: 1, projectId: 'project', label: 'Revocada', state: 'revoked', expiresAt: '2099-01-01' },
    { id: 5, userId: 1, projectId: 'project', label: 'Vencida', state: 'active', expiresAt: '2000-01-01' },
  );
  await f.register();
  const first = await service.inspect(f.ctx());
  assert.deepEqual(first.connections, [
    { id: 1, label: 'Equipo', isOwnConnection: false, runnerId: 1, online: true, busy: false },
    { id: 2, label: 'Mi equipo', isOwnConnection: true, runnerId: null, online: false, busy: false },
  ]);
  const context = f.ctx({ session: 'my-session', catalog: refs });
  context.state.automationConnection = f.state().connections[1];
  await service.register(context);
  const inspection = await service.inspect(f.ctx());
  assert.equal(inspection.connections.length, 2);
  assert.ok(inspection.connections.every(connection => connection.online && !connection.busy));
  const job = await f.enqueue({ runnerId: inspection.connections[1].runnerId });
  assert.equal(job.runnerId, 2);
  f.state().runners[1].lastSeenAt = '2000-01-01';
  const offline = await service.inspect(f.ctx());
  assert.equal(offline.connections[1].online, false);
  assert.equal(offline.connections[1].runnerId, 2);
  assert.equal(offline.connections[0].online, true);
});

test('publication rolls back all writes if a selected row disappeared; arbitrary commands are rejected', async () => {
  const f = fixture(); await f.register();
  await assert.rejects(f.enqueue({ command: 'echo unexpected' }), /comandos/);
  const job = await f.enqueue();
  await service.poll(f.ctx({ claim: true }));
  f.state().results.splice(1, 1);
  await assert.rejects(service.complete(f.ctx({ jobId: job.id,
    results: refs.map(automationReference => ({ automationReference, status: 'passed' })) })), /pertenece/);
  assert.equal(f.state().results[0].result, 'not_executed');
  assert.equal(f.state().writes, 0);
  assert.equal(f.state().jobs[0].state, 'running');
});

test('a queued job is interrupted if its references change before claim', async () => {
  const f = fixture(); await f.register(); await f.enqueue();
  f.state().cases[0].automationReference = 'changed::test';
  assert.equal((await service.poll(f.ctx({ claim: true }))).claimed, false);
  assert.equal(f.state().jobs[0].state, 'interrupted');
  assert.equal(f.state().writes, 0);
});

test('environment defaults to local and unsupported or invalid environments cannot enqueue', async () => {
  const f = fixture(); await f.register();
  await assert.rejects(f.enqueue({ environment: 'test' }), /ambiente/);
  for (const environment of ['production', '', null, { command: 'test' }]) {
    await assert.rejects(f.enqueue({ environment }), /ambiente/);
  }
  assert.equal(f.state().jobs.length, 0);
  const job = await f.enqueue();
  assert.equal(job.environment, 'local');
  assert.equal((await service.poll(f.ctx({ claim: true }))).job.environment, 'local');
});

test('test environment survives inspection, claim, publication and idempotent retries', async () => {
  const f = fixture();
  await service.register(f.ctx({ catalog: refs, environments: ['local', 'test'] }));
  const inspection = await service.inspect(f.ctx());
  assert.deepEqual(inspection.runners[0].environments, ['local', 'test']);
  const job = await f.enqueue({ environment: 'test' });
  assert.equal(job.environment, 'test');
  assert.equal((await f.enqueue({ environment: 'test' })).id, job.id);
  await assert.rejects(f.enqueue({ environment: 'local' }), /otra selección/);
  assert.equal((await service.inspect(f.ctx())).jobs[0].environment, 'test');
  assert.equal((await service.poll(f.ctx({ claim: true }))).job.environment, 'test');
  const completed = await service.complete(f.ctx({ jobId: job.id,
    results: refs.map(automationReference => ({ automationReference, status: 'passed' })) }));
  assert.equal(completed.environment, 'test');
  const details = f.ctx();
  Object.assign(details.params, { jobId: String(job.id) });
  assert.equal((await service.details(details)).environment, 'test');
});

test('runner registration only accepts supported unique environments', async () => {
  const f = fixture();
  for (const environments of [[], ['production'], ['local', 'local'], 'test']) {
    await assert.rejects(service.register(f.ctx({ catalog: refs, environments })), /ambientes/);
  }
  assert.equal(f.state().runners.length, 0);
});

test('a queued Test job cannot be claimed after the runner loses Test support', async () => {
  const f = fixture();
  await service.register(f.ctx({ catalog: refs, environments: ['local', 'test'] }));
  await f.enqueue({ environment: 'test' });
  await service.register(f.ctx({ catalog: refs, environments: ['local'] }));
  const claim = await service.poll(f.ctx({ claim: true }));
  assert.equal(claim.claimed, false);
  assert.equal(claim.job, null);
  assert.equal(f.state().jobs[0].state, 'interrupted');
  assert.equal(f.state().writes, 0);
});
