import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, context } from '../../../utils/tenant-test-fixture';
import { syncBatchTestRunResults } from './test-run-result';
import cycleFactory from '../../test-cycle-execution/controllers/test-cycle-execution';
import tenantAccess from '../../../policies/tenant-access';
import { ENGINEERING_ROLES } from '../../../utils/access';

function setup() {
  const f = fixture();
  const effects: string[] = [];
  const documents = f.strapi.documents;
  f.strapi.contentType = () => ({ kind: 'collectionType' });
  f.strapi.documents = (uid: string) => ({
    ...documents(uid),
    findFirst: async ({ filters }: any) => uid === 'api::test-case.test-case'
      && filters.documentId === 'new-case' && filters.project?.documentId === 'pA'
      && filters.organization?.documentId === 'A'
      ? { ...f.entities.own, documentId: 'new-case', functionality: { documentId: 'feature' } } : null,
    findMany: async (args: any) => uid.includes('organization-') ? documents(uid).findMany(args)
      : uid === 'api::test-run-result.test-run-result' || uid === 'api::test-cycle-execution.test-cycle-execution'
        ? [{ documentId: 'old', moduleName: 'M' }, { documentId: 'duplicate', moduleName: 'M' }] : uid === 'api::test-case.test-case' ? [{ documentId: 'new-case' }] : [],
    update: async (args: any) => { effects.push(`update:${uid}`); return { documentId: args.documentId, ...args.data }; },
    create: async (args: any) => { effects.push(`create:${uid}`); return { documentId: 'new', ...args.data }; },
    delete: async () => { effects.push(`delete:${uid}`); return {}; },
  });
  (globalThis as any).strapi = f.strapi;
  return { ...f, effects };
}

for (const kind of ['run', 'cycle'] as const) {
  const uid = kind === 'run' ? 'api::test-run-result.test-run-result' : 'api::test-cycle-execution.test-cycle-execution';
  async function invoke(f: ReturnType<typeof setup>, payload: any, withPolicy = false) {
    const ctx: any = context(undefined, payload, 'POST');
    if (withPolicy) await tenantAccess(ctx, { contentTypeUid: uid, allowedRoles: ENGINEERING_ROLES }, { strapi: f.strapi });
    if (kind === 'run') return syncBatchTestRunResults(1, ctx.request.body.data);
    return cycleFactory({ strapi: f.strapi }).batchSync(ctx);
  }
  for (const [source, error] of [['foreign', /Cross-organization/], ['viewer', /cannot perform/], ['restricted', /cannot perform/]] as const) {
    test(`${kind} bulk rejects persisted ${source} before any destructive effect`, async () => {
      const f = setup();
      if (source === 'restricted') f.memberships[1].organizationRole.code = 'manager';
      await assert.rejects(invoke(f, { [kind === 'run' ? 'testRun' : 'testCycle']: source, organization: 'A', project: 'pA', items: [] }, true), error);
      assert.deepEqual(f.effects, []);
    });
  }
  for (const destination of [{ project: 'pA2' }, { organization: 'B' }, { organization: null }, { project: { disconnect: ['pA'] } }]) {
    test(`${kind} bulk rejects discordant or malformed destination ${JSON.stringify(destination)}`, async () => {
      const f = setup();
      await assert.rejects(invoke(f, { [kind === 'run' ? 'testRun' : 'testCycle']: 'own', items: [], ...destination }), /match|Invalid/);
      assert.deepEqual(f.effects, []);
    });
  }
  for (const operation of ['create', 'update'] as const) {
    test(`${kind} bulk own ${operation} remains available`, async () => {
      const f = setup();
      const payload = { [kind === 'run' ? 'testRun' : 'testCycle']: 'own', organization: 'A', project: 'pA',
        items: [{ ...(operation === 'update' ? { documentId: 'old' } : {}), data: { testCase: operation === 'create' ? 'new-case' : undefined, result: 'passed' } }] };
      await invoke(f, payload, true);
      assert.ok(f.effects.includes(`${operation}:${uid}`));
    });
  }
  test(`${kind} bulk own empty sync retains intentional deletion`, async () => {
    const f = setup();
    await invoke(f, { [kind === 'run' ? 'testRun' : 'testCycle']: 'own', organization: 'A', project: 'pA', items: [] }, true);
    assert.ok(f.effects.some(effect => effect.startsWith('delete:')));
  });
}
