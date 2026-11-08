import test from 'node:test';
import assert from 'node:assert/strict';
import moduleFactory from './project-module';
import { context, fixture } from '../../../utils/tenant-test-fixture';

function setup() {
  const f = fixture();
  f.strapi.contentType = () => ({ kind: 'collectionType' });
  Object.assign(f.entities.own, { name: 'Original', description: 'Existing module description',
    functionalities: [{ documentId: 'feature-A' }] });
  const writes: any[] = [];
  const documents = f.strapi.documents;
  f.strapi.documents = (uid: string) => ({
    ...documents(uid),
    update: async ({ documentId, data }: any) => {
      writes.push(structuredClone(data));
      f.entities[documentId].description = 'Concurrent description';
      Object.assign(f.entities[documentId], data);
      return structuredClone(f.entities[documentId]);
    },
  });
  (globalThis as any).strapi = f.strapi;
  return { ...f, writes, controller: moduleFactory({ strapi: f.strapi }) };
}

test('Canvas module name-only generic PUT preserves description and omitted relations without stale rewrites', async () => {
  const f = setup();
  const before = structuredClone(f.entities.own);
  const ctx: any = context('own', { name: 'Renamed' });
  await f.controller.update(ctx);
  assert.deepEqual(f.writes, [{ name: 'Renamed' }]);
  assert.deepEqual(ctx.body.data, { ...before, name: 'Renamed', description: 'Concurrent description' });
});

test('generic module update preserves an explicit null description clear', async () => {
  const f = setup();
  const ctx: any = context('own', { description: null });
  await f.controller.update(ctx);
  assert.deepEqual(f.writes, [{ description: null }]);
  assert.equal(ctx.body.data.name, 'Original');
  assert.equal(ctx.body.data.description, null);
});

test('generic module create keeps its historic empty description default', async () => {
  const f = setup();
  const ctx: any = context(undefined, { name: 'New module', project: 'pA' }, 'POST');
  await f.controller.create(ctx);
  assert.deepEqual(ctx.body.data, { documentId: 'created', name: 'New module',
    description: '', organization: 'A', project: 'pA' });
});

for (const [source, error] of [
  ['foreign', /Cross-organization/], ['viewer', /cannot perform/], ['restricted', /not assigned/],
] as const) {
  test(`partial module update rejects persisted ${source} before writes even with an owned destination`, async () => {
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
  test(`partial module update keeps tenant relation validation for ${JSON.stringify(payload)}`, async () => {
    const f = setup();
    await assert.rejects(f.controller.update(context('own', { name: 'Renamed', ...payload }) as any), error);
    assert.deepEqual(f.writes, []);
  });
}

test('module partial update supports core params.id and explicitly supplied same-tenant project relations', async () => {
  const f = setup();
  const ctx: any = context(undefined, { name: 'Moved', project: 'pA2' });
  ctx.params.id = 'own';
  await f.controller.update(ctx);
  assert.deepEqual(f.writes, [{ name: 'Moved', project: 'pA2' }]);
  assert.equal(ctx.body.data.organization.documentId, 'A');
  assert.equal(ctx.body.data.description, 'Concurrent description');
});
