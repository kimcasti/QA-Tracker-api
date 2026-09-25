import assert from 'node:assert/strict';
import { test } from 'node:test';
import service from './automation-runner';
import { catalogInput, digest, referenceProblem, validateOutcomes } from './protocol';

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
    runners: [], jobs: [],
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
          const trx = () => ({ where: () => ({ forUpdate: () => ({ first: async () => ({}) }) }) });
          return await work({ trx });
        } catch (error) { store = snapshot; throw error; }
        finally { release(); }
      },
      query: (uid: string) => {
        const key = uid.includes('automation-connection') ? 'connections' : uid.includes('automation-runner') ? 'runners' : 'jobs';
        return {
          findOne: async ({ where }: any) => store[key].find((r: any) => matches(r, where)) || null,
          findMany: async ({ where, orderBy, limit }: any) => {
            const rows = store[key].filter((r: any) => matches(r, where));
            if (orderBy?.id === 'desc') rows.reverse();
            return rows.slice(0, limit || rows.length);
          },
          create: async ({ data }: any) => {
            for (const field of key === 'jobs' ? ['activeRun', 'activeRunner', 'requestKey'] : ['connectionId']) {
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
