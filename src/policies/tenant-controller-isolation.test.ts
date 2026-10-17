import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, context } from '../utils/tenant-test-fixture';
import meetingNote from '../api/meeting-note/controllers/meeting-note';
import bug from '../api/bug/controllers/bug';

for (const name of ['delivery-unit', 'delivery-activity-template', 'project-story-map', 'project-module', 'project-persona-role', 'sprint', 'test-case-template', 'test-plan', 'test-run', 'test-run-result', 'test-cycle-execution', 'project-proposal']) {
  test(`${name} update independently authorizes persisted origin`, async () => {
    const f = fixture();
    f.strapi.contentType = () => ({ kind: 'collectionType' });
    (globalThis as any).strapi = f.strapi;
    const { default: factory } = await import(`../api/${name}/controllers/${name}.ts`);
    const controller = factory({ strapi: f.strapi });
    await assert.rejects(controller.update(context('foreign', { organization: 'A', project: 'pA', testRun: 'own', testCycle: 'own', module: 'module', moduleName: 'module', code: 'CODE', name: 'item', title: 'item' }) as any), /Cross-organization/);
    assert.ok(!f.calls.includes('update'));
  });
}

for (const name of ['functionality', 'test-case', 'project']) {
  test(`${name} update independently authorizes persisted tenant and tenant role`, async () => {
    const f = fixture();
    f.entities.foreign.functionality = { documentId: 'own' };
    f.entities.A = { documentId: 'A', plan: 'enterprise' };
    f.strapi.contentType = () => ({ kind: 'collectionType' });
    (globalThis as any).strapi = f.strapi;
    const { default: factory } = await import(`../api/${name}/controllers/${name}.ts`);
    const controller = factory({ strapi: f.strapi });
    const id = name === 'project' ? 'pX' : 'foreign';
    await assert.rejects(controller.update(context(id, { organization: 'A', project: 'pA', functionality: 'own', code: 'CODE' }) as any), /Cross-organization/);
    assert.ok(!f.calls.includes('update'));
  });
}

test('execution persist authorizes origin before deduplication or writes', async () => {
  const f = fixture();
  f.entities.foreign.testCycle = { documentId: 'own' };
  f.strapi.contentType = () => ({ kind: 'collectionType' });
  (globalThis as any).strapi = f.strapi;
  const { default: factory } = await import('../api/test-cycle-execution/controllers/test-cycle-execution');
  const controller = factory({ strapi: f.strapi });
  await assert.rejects(controller.persist(context('foreign', { organization: 'A', project: 'pA' }, 'POST') as any), /Cross-organization/);
  assert.ok(!f.calls.includes('update'));
});

test('bug summary independently scopes queries without relying on a route guard', async () => {
  const f = fixture();
  f.strapi.contentType = () => ({ kind: 'collectionType' });
  let query: any;
  f.strapi.service = () => ({ find: async (input: any) => { query = input; return { results: [], pagination: {} }; } });
  (globalThis as any).strapi = f.strapi;
  const controller = bug({ strapi: f.strapi });
  controller.validateQuery = async () => {};
  controller.sanitizeQuery = async (ctx: any) => ctx.query;
  controller.sanitizeOutput = async (data: any) => data;
  controller.transformResponse = (data: any) => data;
  const ctx = context(undefined, {}, 'GET');
  ctx.query = { filters: { title: { $contains: 'needle' } }, sort: ['title:asc'] };
  await controller.listSummary(ctx as any);
  assert.deepEqual(query.filters.organization.documentId.$in, ['A', 'B']);
  assert.ok(query.filters.$or);
  assert.deepEqual(query.filters.title, { $contains: 'needle' });
  assert.deepEqual(query.sort, ['title:asc']);
});

for (const [name, factory] of [['meeting-note', meetingNote], ['bug', bug]] as const) {
  test(`${name} create independently rejects viewer B despite owner A`, async () => {
    const f = fixture();
    f.strapi.contentType = () => ({ kind: 'collectionType' });
    (globalThis as any).strapi = f.strapi;
    const controller = factory({ strapi: f.strapi });
    await assert.rejects(controller.create(context(undefined, { organization: 'B', project: 'pB' }, 'POST') as any), /cannot perform this action/);
    assert.ok(!f.calls.includes('create'));
  });

  test(`${name} own creation and same-tenant project transfer remain available`, async () => {
    const f = fixture();
    f.strapi.contentType = () => ({ kind: 'collectionType' });
    (globalThis as any).strapi = f.strapi;
    const controller = factory({ strapi: f.strapi });
    const creation: any = context(undefined, { project: 'pA', title: 'new' }, 'POST');
    await controller.create(creation);
    assert.equal(creation.body.data.organization, 'A');
    const update: any = context('own', { project: { set: ['pA2'] }, title: 'moved' });
    await controller.update(update);
    assert.equal(update.body.data.project, 'pA2');
    assert.equal(update.body.data.organization, 'A');
  });

  test(`${name} controller independently rejects a foreign origin before update`, async () => {
    const f = fixture();
    f.strapi.contentType = () => ({ kind: 'collectionType' });
    (globalThis as any).strapi = f.strapi;
    const controller = factory({ strapi: f.strapi });
    await assert.rejects(controller.update(context('foreign', { organization: 'A', project: 'pA' }) as any), /Cross-organization/);
    assert.ok(!f.calls.includes('update'));
  });
}
