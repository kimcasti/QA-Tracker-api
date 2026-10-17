import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, context } from '../../../utils/tenant-test-fixture';
import { createProjectController } from './project';
import commentFactory from '../../project-comment/controllers/project-comment';

for (const action of ['storyMap', 'upsertStoryMap', 'comments'] as const) {
  test(`${action} owner A remains unrestricted despite viewer B; B assignments still enforced`, async () => {
    const f = fixture();
    f.strapi.contentType = () => ({ kind: 'collectionType' });
    (globalThis as any).strapi = f.strapi;
    const project = createProjectController({ strapi: f.strapi });
    const comments = commentFactory({ strapi: f.strapi });
    const invoke = async (id: string) => {
      const ctx: any = context(id, { snapshot: '{}' }, action === 'upsertStoryMap' ? 'PUT' : 'GET');
      ctx.query = { project: id };
      if (action === 'comments') await comments.find(ctx);
      else await project[action](ctx);
      return ctx;
    };
    await invoke('pA');
    await invoke('pB');
    await assert.rejects(invoke('pB2'), /not assigned/);
    await assert.rejects(invoke('pX'), /Cross-organization|do not have access/);
  });
}
