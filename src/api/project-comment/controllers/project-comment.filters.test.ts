import assert from 'node:assert/strict';
import test from 'node:test';
import createController from './project-comment';
import router from '../routes/project-comment';
import policy from '../../../policies/tenant-access';
import { fixture, context } from '../../../utils/tenant-test-fixture';

test('comment list intersects caller and real route policy filters with the required project', async () => {
  const old = (globalThis as any).strapi;
  const f = fixture();
  const model = { uid: 'api::project-comment.project-comment', kind: 'collectionType',
    info: { singularName: 'project-comment', pluralName: 'project-comments' }, attributes: {} };
  f.strapi.contentType = () => model;
  f.strapi.getModel = () => model;
  f.strapi.plugin = () => ({ service: () => ({ isLocalizedContentType: () => false }) });
  const documents = f.strapi.documents;
  let query: any;
  f.strapi.documents = (uid: string) => uid === model.uid ? {
    findMany: async (input: any) => { query = input; return []; },
  } : documents(uid);
  (globalThis as any).strapi = f.strapi;
  try {
    const route: any = router.routes.find((r: any) => r.method === 'GET' && !r.path.includes('/:'));
    assert.ok(route);
    const ctx: any = context(undefined, {}, 'GET');
    ctx.query = { project: 'pA', filters: { $or: [{ isPinned: true }, { content: { $containsi: 'release' } }] } };
    await policy(ctx, route.config.policies[0].config, f);
    const authorizedFilters = ctx.query.filters;
    await createController({ strapi: f.strapi }).find(ctx);
    assert.deepEqual(query.filters, { $and: [authorizedFilters, { project: { documentId: { $eq: 'pA' } } }] });
  } finally {
    (globalThis as any).strapi = old;
  }
});
