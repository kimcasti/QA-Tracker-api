import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sanitize, validate } from '@strapi/utils';
import bugController from './bug';
import summaryRoutes from '../routes/list-summary';
import coreRoutes from '../routes/bug';
import tenantAccess from '../../../policies/tenant-access';
import { fixture, context } from '../../../utils/tenant-test-fixture';

function setup() {
  const f = fixture();
  const models = new Map<string, any>();
  const getModel = (uid: string) => {
    // Plugin user models are only traversed by the route schema generator; no
    // user/account fields participate in these bug-query fixtures.
    if (uid.startsWith('plugin::')) return { uid, kind: 'collectionType', options: {}, attributes: {} };
    if (!models.has(uid)) {
      const name = uid.split('::')[1].split('.')[0];
      const schema = JSON.parse(readFileSync(resolve(__dirname, `../../${name}/content-types/${name}/schema.json`), 'utf8'));
      models.set(uid, { ...schema, uid, modelType: 'contentType', attributes: {
        id: { type: 'integer' }, documentId: { type: 'string' }, ...schema.attributes,
      } });
    }
    return models.get(uid);
  };
  const queries: any[] = [];
  const authScopes: string[] = [];
  f.strapi.contentType = getModel;
  f.strapi.getModel = getModel;
  f.strapi.config = { get: () => undefined };
  f.strapi.log = { debug: () => {}, error: () => {} };
  f.strapi.plugin = () => ({ service: () => ({ isLocalizedContentType: () => false }) });
  f.strapi.auth = { verify: async (_auth: any, { scope }: any) => {
    authScopes.push(scope);
    if (scope === 'api::organization.organization.find') throw new Error('Organization listing is not granted');
  } };
  f.strapi.contentAPI = {
    validate: validate.createAPIValidators({ getModel }),
    sanitize: sanitize.createAPISanitizers({ getModel }),
  };
  f.strapi.service = () => ({ find: async (query: any) => {
    queries.push(query);
    return { results: [{ documentId: 'bug-a', internalBugId: 'BUG-1', title: 'Synthetic defect',
      organization: { documentId: 'A', name: 'Synthetic tenant' },
    }], pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } };
  } });
  (globalThis as any).strapi = f.strapi;
  const controller: any = bugController({ strapi: f.strapi });
  return { ...f, controller, queries, authScopes };
}

async function runReadPolicy(ctx: any, strapi: any, summary = true) {
  const routes = (typeof coreRoutes.routes === 'function' ? coreRoutes.routes() : coreRoutes.routes) as unknown as Array<{
    handler: string; config: { policies: Array<{ name: string; config: any }> };
  }>;
  const route = summary ? summaryRoutes.routes[0]
    : routes.find(route => route.handler === 'api::bug.bug.find');
  assert.ok(route, 'the real bug read route is registered');
  for (const policy of route.config.policies as Array<{ name: string; config: any }>) {
    assert.ok(['global::tenant-access', 'api::bug.read-access'].includes(policy.name));
    const handler = policy.name === 'global::tenant-access'
      ? tenantAccess
      : (await import('../policies/read-access')).default;
    await handler(ctx, policy.config, { strapi });
  }
}

test('bug summary reads with real Strapi query validation without organization listing permission', async () => {
  const f = setup();
  const ctx: any = context(undefined, {}, 'GET');
  ctx.state.auth = { credentials: { id: 1 } };
  ctx.query = { filters: { project: { documentId: { $eq: 'pA' } } }, sort: 'detectedAt:desc' };
  await runReadPolicy(ctx, f.strapi);
  const response = await f.controller.listSummary(ctx);
  assert.equal(response.data[0].internalBugId, 'BUG-1');
  assert.equal(response.meta.pagination.total, 1);
  assert.equal(f.queries.length, 1);
  const filters = f.queries[0].filters;
  assert.deepEqual(filters.project, { documentId: { $eq: 'pA' } });
  assert.deepEqual(filters.organization, { documentId: { $in: ['A', 'B'] } });
  assert.ok(filters.$or, 'restricted viewer project scope survives sanitization');
  assert.equal(f.queries[0].sort, 'detectedAt:desc');
});

for (const summary of [false, true]) {
  const action = summary ? 'listSummary' : 'find';

  test(`${action} keeps client predicates, pagination and mandatory scope through the real route`, async () => {
    const f = setup();
    const ctx: any = context(undefined, {}, 'GET');
    ctx.state.auth = { credentials: { id: 1 } };
    ctx.query = {
      filters: { internalBugId: { $eq: 'BUG-1' }, $or: [
        { project: { documentId: { $eq: 'pA' } } },
        { project: { documentId: { $eq: 'pX' } } },
      ] },
      pagination: { page: 1, pageSize: 1 },
    };
    const originalQuery = structuredClone(ctx.query);
    await runReadPolicy(ctx, f.strapi, summary);
    assert.deepEqual(ctx.query, originalQuery, 'route authorization must not contaminate client query');
    const response = await f.controller[action](ctx);
    assert.equal(response.data[0].internalBugId, 'BUG-1');
    assert.equal(Object.hasOwn(response.data[0], 'organization'), false, 'output must not expose a forbidden relation');
    assert.ok(f.authScopes.includes('api::organization.organization.find'));
    const query = f.queries[0];
    assert.deepEqual(query.pagination, { page: 1, pageSize: 1 });
    const [client, scope] = query.filters.$and;
    assert.deepEqual(client, originalQuery.filters);
    assert.deepEqual(scope.organization, { documentId: { $in: ['A', 'B'] } });
    assert.deepEqual(scope.$or, [
      { organization: { documentId: { $in: ['A'] } } },
      { organization: { documentId: { $in: ['B'] } }, project: { documentId: { $in: ['pB'] } } },
    ]);
  });

  test(`${action} independently enforces tenant scope without a route guard`, async () => {
    const f = setup();
    const ctx: any = context(undefined, {}, 'GET');
    ctx.state.auth = { credentials: { id: 1 } };
    ctx.query = { filters: { linkedSourceId: { $eq: 'synthetic-source' } } };
    await f.controller[action](ctx);
    assert.deepEqual(f.queries[0].filters.organization.documentId.$in, ['A', 'B']);
    assert.deepEqual(f.queries[0].filters.linkedSourceId, { $eq: 'synthetic-source' });
    assert.ok(f.queries[0].filters.$or);
  });

  for (const filters of [
    { unknownBugField: { $eq: 'invalid' } },
    { organization: { documentId: { $eq: 'X' } } },
  ]) {
    test(`${action} still rejects client filter ${Object.keys(filters)[0]} before any bug read`, async () => {
      const f = setup();
      const ctx: any = context(undefined, {}, 'GET');
      ctx.state.auth = { credentials: { id: 1 } };
      ctx.query = { filters };
      await runReadPolicy(ctx, f.strapi, summary);
      await assert.rejects(f.controller[action](ctx), (error: any) => {
        assert.equal(error.name, 'ValidationError');
        assert.equal(error.details.source, 'query');
        assert.equal(error.details.param, 'filters');
        return true;
      });
      assert.equal(f.queries.length, 0);
    });
  }

  test(`${action} route denies anonymous users before any bug read`, async () => {
    const f = setup();
    const ctx: any = context(undefined, {}, 'GET');
    ctx.state.auth = { credentials: { id: 1 } };
    ctx.state.user = undefined;
    await assert.rejects(runReadPolicy(ctx, f.strapi, summary), /Authentication is required/);
    assert.equal(f.queries.length, 0);
  });

  test(`${action} denies an authenticated user with no active tenant membership`, async () => {
    const f = setup();
    f.memberships.splice(0);
    const documents = f.strapi.documents;
    f.strapi.documents = (uid: string) => ({
      ...documents(uid),
      findFirst: async ({ filters }: any) => uid.includes('organization-membership') && !filters.isActive
        ? { documentId: 'inactive-membership' } : null,
    });
    const ctx: any = context(undefined, {}, 'GET');
    ctx.state.auth = { credentials: { id: 1 } };
    const forbidden = (error: any) => error.name === 'ForbiddenError';
    await assert.rejects(runReadPolicy(ctx, f.strapi, summary), forbidden);
    await assert.rejects(f.controller[action](ctx), forbidden);
    assert.equal(f.queries.length, 0);
  });
}
