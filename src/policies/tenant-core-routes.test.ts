import test from 'node:test';
import assert from 'node:assert/strict';
import { factories } from '@strapi/strapi';
import policy from './tenant-access';
import { fixture, context } from '../utils/tenant-test-fixture';

const config = { contentTypeUid: 'api::meeting-note.meeting-note', allowedRoles: ['owner'] };
function coreRoutes() {
  const old = (globalThis as any).strapi;
  const model = { uid: config.contentTypeUid, kind: 'collectionType',
    info: { singularName: 'meeting-note', pluralName: 'meeting-notes' }, attributes: {} };
  (globalThis as any).strapi = {
    contentType: () => model, getModel: () => model,
    plugin: () => ({ service: () => ({ isLocalizedContentType: () => false }) }),
  };
  try { return factories.createCoreRouter(config.contentTypeUid as any).routes; }
  finally { (globalThis as any).strapi = old; }
}

for (const method of ['GET', 'PUT', 'DELETE']) {
  test(`actual core router ${method} parameter authorizes the persisted resource`, async () => {
    const route = coreRoutes().find((r: any) => r.method === method && r.path.includes('/:'))!;
    assert.ok(route, 'Expected an actual installed Strapi core route.');
    const parameter = route.path.split('/:')[1];
    assert.equal(parameter, 'id');
    const f = fixture();
    const ctx: any = context(undefined, {}, method);
    ctx.params = { [parameter]: 'foreign' };
    await assert.rejects(policy(ctx, config, f), /Cross-organization/);
    assert.ok(f.calls.some(call => call.endsWith(':foreign')));
    ctx.params = { [parameter]: 'own' };
    assert.equal(await policy(ctx, config, f), true);
  });
}
