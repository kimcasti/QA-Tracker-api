import test from 'node:test';
import assert from 'node:assert/strict';
import functionalityFactory, { createFunctionalityController } from './functionality';
import { context, fixture } from '../../../utils/tenant-test-fixture';

function setup() {
  const f = fixture();
  f.strapi.contentType = () => ({ kind: 'collectionType' });
  Object.assign(f.entities.own, {
    code: 'QA-17', name: 'Original', jiraIssueKey: 'QA-99',
    jiraTaskUrl: 'https://example.test/QA-99', jiraIssueType: 'Story',
    testTypes: ['functional', 'uat'], isCore: true, isRegression: true, isSmoke: true,
    lastFunctionalChangeAt: '2026-01-02T10:00:00.000Z', storyLegacyId: 'legacy-17', sortOrder: 23,
    status: 'completed', priority: 'high', impactLevel: 'high', probabilityLevel: 'low',
    deliveryDate: '2026-01-09', module: { documentId: 'module-A' },
    sprint: { documentId: 'sprint-A' }, deliveryUnit: { documentId: 'unit-A' },
    personaRoles: [{ documentId: 'role-A' }], testCases: [{ documentId: 'case-A' }],
  });
  const writes: any[] = [];
  const documents = f.strapi.documents;
  f.strapi.documents = (uid: string) => ({
    ...documents(uid),
    update: async ({ documentId, data }: any) => {
      writes.push(structuredClone(data));
      // A concurrent domain edit after the read must not be overwritten by a stale snapshot.
      f.entities[documentId].jiraIssueKey = 'QA-CONCURRENT';
      Object.assign(f.entities[documentId], data);
      return structuredClone(f.entities[documentId]);
    },
  });
  (globalThis as any).strapi = f.strapi;
  return { ...f, writes, controller: functionalityFactory({ strapi: f.strapi }) };
}

test('Canvas-shaped generic PUT updates only supplied fields and preserves QA metadata and omitted relations', async () => {
  const f = setup();
  const before = structuredClone(f.entities.own);
  // saveCanvasFunctionality sends only name and the optional fields actually edited;
  // it deliberately omits code, Jira, QA flags, roles, sort order and tenant relations.
  const payload = { name: 'Renamed', priority: null, status: null,
    impactLevel: null, probabilityLevel: null, deliveryDate: null, sprint: null };
  const ctx: any = context('own', payload);
  await f.controller.update(ctx);
  assert.deepEqual(f.writes, [payload], 'the persistence patch must not materialize omitted fields');
  assert.deepEqual(ctx.body.data, { ...before, jiraIssueKey: 'QA-CONCURRENT', ...payload });
  assert.deepEqual(ctx.request.body.data, payload, 'authorization must not expand this update payload');
});

test('generic functionality update preserves explicit null clears including optional sort order', async () => {
  const f = setup();
  const payload = { jiraIssueKey: null, jiraTaskUrl: null, jiraIssueType: null,
    lastFunctionalChangeAt: null, storyLegacyId: null, sortOrder: null,
    module: null, deliveryUnit: null, personaRoles: { set: [] },
    testTypes: [], isCore: false, isRegression: false, isSmoke: false };
  const ctx: any = context('own', payload);
  await f.controller.update(ctx);
  assert.deepEqual(f.writes, [payload]);
  assert.equal(ctx.body.data.code, 'QA-17');
  assert.equal(ctx.body.data.name, 'Original');
});

test('generic functionality update still normalizes explicitly supplied code and Jira values', async () => {
  const f = setup();
  const ctx: any = context('own', { code: ' NEXT-1 ', jiraIssueKey: ' QA-100 ',
    jiraTaskUrl: ' https://example.test/QA-100 ', jiraIssueType: ' Task ', sortOrder: 0 });
  await f.controller.update(ctx);
  assert.deepEqual(f.writes, [{ code: 'NEXT-1', jiraIssueKey: 'QA-100',
    jiraTaskUrl: 'https://example.test/QA-100', jiraIssueType: 'Task', sortOrder: 0 }]);
});

test('generic functionality create retains historic omission defaults', async () => {
  const f = setup();
  const controller = createFunctionalityController({ strapi: f.strapi, dependencies: {
    assertOrganizationLimitAvailable: async () => ({ effectivePlan: 'starter' } as any),
  } });
  const ctx: any = context(undefined, { name: 'New', code: ' QA-18 ', project: 'pA' }, 'POST');
  await controller.create(ctx);
  assert.deepEqual(ctx.body.data, { documentId: 'created', name: 'New', code: 'QA-18',
    jiraIssueKey: null, jiraTaskUrl: null, jiraIssueType: null, testTypes: [],
    isCore: false, isRegression: false, isSmoke: false, lastFunctionalChangeAt: null,
    deliveryDate: null, status: 'backlog', priority: 'medium', impactLevel: 'medium',
    probabilityLevel: 'medium', storyLegacyId: null, sortOrder: 0,
    organization: 'A', project: 'pA' });
});

for (const [source, error] of [
  ['foreign', /Cross-organization/], ['viewer', /cannot perform/], ['restricted', /not assigned/],
] as const) {
  test(`partial functionality update rejects persisted ${source} before writes even with an owned destination`, async () => {
    const f = setup();
    if (source === 'restricted') f.memberships[1].organizationRole.code = 'manager';
    await assert.rejects(f.controller.update(context(source, { name: 'Renamed',
      organization: 'A', project: 'pA' }) as any), error);
    assert.deepEqual(f.writes, []);
  });
}

for (const [payload, error] of [
  [{ project: 'pX' }, /Cross-organization|reassignment/],
  [{ project: 'pB', organization: 'A' }, /do not match/],
  [{ project: null }, /Invalid project/],
] as const) {
  test(`partial functionality update keeps tenant relation validation for ${JSON.stringify(payload)}`, async () => {
    const f = setup();
    await assert.rejects(f.controller.update(context('own', { name: 'Renamed', ...payload }) as any), error);
    assert.deepEqual(f.writes, []);
  });
}

test('functionality partial update supports core params.id and validates omitted code identity without rewriting it', async () => {
  const f = setup();
  const queries: any[] = [];
  const documents = f.strapi.documents;
  f.strapi.documents = (uid: string) => ({
    ...documents(uid),
    findMany: async (query: any) => {
      if (uid !== 'api::functionality.functionality') return documents(uid).findMany(query);
      queries.push(query);
      return [{ documentId: 'own', code: 'QA-17' }];
    },
  });
  const ctx: any = context(undefined, { name: 'Renamed' });
  ctx.params.id = 'own';
  await f.controller.update(ctx);
  assert.equal(queries[0].filters.code.$eq, 'QA-17');
  assert.deepEqual(f.writes, [{ name: 'Renamed' }]);
});
