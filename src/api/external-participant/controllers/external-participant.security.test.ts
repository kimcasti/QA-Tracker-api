import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../routes/external-participant';
import controllerFactory from './external-participant';
import policy from '../../../policies/tenant-access';
import { READ_ROLES } from '../../../utils/access';
import { fixture, context } from '../../../utils/tenant-test-fixture';

function matches(row: any, filter: any): boolean {
  return Object.entries(filter ?? {}).every(([key, value]: [string, any]) => {
    if (key === '$and') return value.every((part: any) => matches(row, part));
    if (key === '$or') return value.some((part: any) => matches(row, part));
    if (key === '$in') return value.includes(row);
    if (key === '$eq') return row === value;
    if (key === '$null') return value ? row == null : row != null;
    return typeof value === 'object' && value !== null ? matches(row?.[key], value) : row?.[key] === value;
  });
}

const uid = 'api::external-participant.external-participant';
function setup() {
  const f = fixture();
  const model = { uid, kind: 'collectionType', info: { singularName: 'external-participant', pluralName: 'external-participants' }, attributes: {} };
  f.strapi.contentType = () => model;
  f.strapi.getModel = () => model;
  f.strapi.plugin = () => ({ service: () => ({ isLocalizedContentType: () => false }) });
  (globalThis as any).strapi = f.strapi;
  return { ...f, controller: controllerFactory({ strapi: f.strapi }) };
}

test('actual inherited findOne route has tenant policy with READ_ROLES', () => {
  setup();
  const route = router.routes.find((r: any) => r.method === 'GET' && r.path.includes('/:'))!;
  assert.ok(route);
  const guard = (route.config.policies ?? []).find((p: any) => p.name === 'global::tenant-access');
  assert.ok(guard, 'findOne must have tenant guard');
  assert.deepEqual(guard.config.allowedRoles, READ_ROLES);
});

test('organization-directory creation and editing omit absent sourceProject', async () => {
  const f = setup();
  f.entities.own.sourceProject = null;
  const creation: any = context(undefined, { name: 'Contact', organization: 'A' }, 'POST');
  await f.controller.create(creation);
  assert.equal(creation.body.data.organization, 'A');
  const update: any = context('own', { name: 'Updated' });
  await f.controller.update(update);
  assert.equal(update.body.data.organization, 'A');
});

for (const relation of [null, undefined, {}, { disconnect: ['pA'] }, { connect: ['pA', 'pX'] }]) {
  test(`explicit invalid sourceProject ${JSON.stringify(relation)} never falls back on update`, async () => {
    const f = setup();
    f.entities.own.sourceProject = { documentId: 'pA' };
    await assert.rejects(f.controller.update(context('own', { name: 'Contact', sourceProject: relation }) as any), /Invalid sourceProject/);
    assert.ok(!f.calls.includes('update'));
  });
}

for (const id of ['assigned', 'directory', 'unassigned', 'foreign']) {
  test(`actual findOne route guard scopes persisted contact ${id}`, async () => {
    const f = setup();
    Object.assign(f.entities, {
      assigned: { organization: { documentId: 'B' }, sourceProject: { documentId: 'pB' } },
      directory: { organization: { documentId: 'B' }, sourceProject: null },
      unassigned: { organization: { documentId: 'B' }, sourceProject: { documentId: 'pB2' } },
      foreign: { organization: { documentId: 'X' }, sourceProject: null },
    });
    const route = router.routes.find((r: any) => r.method === 'GET' && r.path.includes('/:'))!;
    const guard = route.config.policies.find((p: any) => p.name === 'global::tenant-access');
    const ctx: any = context(undefined, {}, 'GET');
    ctx.params = { [route.path.split('/:')[1]]: id };
    if (id === 'assigned' || id === 'directory') assert.equal(await policy(ctx, guard.config, f), true);
    else await assert.rejects(policy(ctx, guard.config, f), /not assigned|Cross-organization/);
  });
}

for (const data of [
  { sourceProject: 'pX' },
  { organization: 'A', sourceProject: 'pX' },
  { organization: null },
  { sourceProject: { connect: ['pA', 'pX'] } },
]) {
  test(`create rejects unsafe destination ${JSON.stringify(data)}`, async () => {
    const f = setup();
    await assert.rejects(f.controller.create(context(undefined, { name: 'Contact', ...data }, 'POST') as any), /Cross-organization|do not match|Invalid/);
    assert.ok(!f.calls.includes('create'));
  });
}

test('sourceProject-only creation resolves its organization; set relation is preserved on edit', async () => {
  const f = setup();
  const ctx: any = context(undefined, { name: 'Contact', sourceProject: 'pA' }, 'POST');
  await f.controller.create(ctx);
  assert.equal(ctx.body.data.organization, 'A');
  assert.equal(ctx.body.data.sourceProject, 'pA');
  f.entities.own.sourceProject = { documentId: 'pA' };
  const update: any = context('own', { name: 'Contact', sourceProject: { set: ['pA2'] } });
  await f.controller.update(update);
  assert.equal(update.body.data.sourceProject, 'pA2');
});

test('real list policy passes sourceProject predicates to controller without losing caller filter', async () => {
  const f = setup();
  let seen: any;
  const documents = f.strapi.documents;
  f.strapi.documents = (type: string) => type === uid ? { findMany: async (query: any) => { seen = query; return []; } } : documents(type);
  const ctx: any = context(undefined, {}, 'GET');
  ctx.query = { filters: { name: { $eq: 'needle' } } };
  await policy(ctx, { contentTypeUid: uid, allowedRoles: READ_ROLES }, f);
  const scopedFilters = ctx.query.filters;
  await f.controller.find(ctx);
  assert.deepEqual(seen.filters.$and[0], scopedFilters);
  assert.ok(JSON.stringify(seen.filters).includes('sourceProject'));
  assert.ok(!JSON.stringify(seen.filters).includes('"project"'));
});

test('find intersects caller filters and assigned sourceProject/organizational contacts scope', async () => {
  const f = setup();
  const rows = [
    { documentId: 'owner', name: 'wanted', organization: { documentId: 'A' }, sourceProject: { documentId: 'pA' } },
    { documentId: 'assigned', name: 'wanted', organization: { documentId: 'B' }, sourceProject: { documentId: 'pB' } },
    { documentId: 'directory', name: 'wanted', organization: { documentId: 'B' }, sourceProject: null },
    { documentId: 'hidden', name: 'wanted', organization: { documentId: 'B' }, sourceProject: { documentId: 'pB2' } },
    { documentId: 'foreign', name: 'wanted', organization: { documentId: 'X' }, sourceProject: null },
    { documentId: 'other-name', name: 'other', organization: { documentId: 'A' }, sourceProject: null },
  ];
  const documents = f.strapi.documents;
  let seen: any;
  f.strapi.documents = (type: string) => type === uid ? { findMany: async (query: any) => {
    seen = query; return rows.filter(row => matches(row, query.filters));
  } } : documents(type);
  const ctx: any = context(undefined, {}, 'GET');
  ctx.query = { filters: { name: { $eq: 'wanted' } } };
  await f.controller.find(ctx);
  assert.deepEqual(ctx.body.data.map((row: any) => row.documentId), ['owner', 'assigned', 'directory']);
  assert.ok(!JSON.stringify(seen.filters).includes('"project"'), 'schema only has sourceProject');
});
