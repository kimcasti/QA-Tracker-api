import assert from 'node:assert/strict';
import test from 'node:test';
import createController from './project-story-map';
import router from '../routes/project-story-map';
import tenantAccess from '../../../policies/tenant-access';
import { fixture, context } from '../../../utils/tenant-test-fixture';

for (const action of ['create', 'update'] as const) {
  test(`story map ${action} persists the project authorized through set relation syntax`, async () => {
    const old = (globalThis as any).strapi;
    const f = fixture();
    const model = { uid: 'api::project-story-map.project-story-map', kind: 'collectionType',
      info: { singularName: 'project-story-map', pluralName: 'project-story-maps' }, attributes: {} };
    f.strapi.contentType = () => model;
    f.strapi.getModel = () => model;
    f.strapi.plugin = () => ({ service: () => ({ isLocalizedContentType: () => false }) });
    const original = f.strapi.documents;
    let saved: any;
    f.strapi.documents = (uid: string) => uid === 'api::project-story-map.project-story-map' ? {
      ...original(uid),
      create: async (input: any) => { saved = input; return { documentId: 'created', ...input.data }; },
      update: async (input: any) => { saved = input; return { documentId: input.documentId, ...input.data }; },
    } : original(uid);
    (globalThis as any).strapi = f.strapi;
    try {
      const ctx = context(action === 'update' ? 'own' : undefined,
        { snapshot: '{}', organization: 'A', project: { set: ['pA2'] } }, action === 'create' ? 'POST' : 'PUT');
      const route: any = router.routes.find((r: any) => r.method === (action === 'create' ? 'POST' : 'PUT'));
      await tenantAccess(ctx, route.config.policies[0].config, f);
      await createController({ strapi: f.strapi })[action](ctx);
      assert.equal(saved.data.project, 'pA2');
      assert.equal(saved.data.organization, 'A');
      saved = undefined;
      const foreign = context(action === 'update' ? 'own' : undefined,
        { snapshot: '{}', organization: 'X', project: { set: ['pX'] } }, action === 'create' ? 'POST' : 'PUT');
      await assert.rejects(tenantAccess(foreign, route.config.policies[0].config, f), /Cross-organization|reassignment/);
      assert.equal(saved, undefined);
    } finally {
      (globalThis as any).strapi = old;
    }
  });
}
