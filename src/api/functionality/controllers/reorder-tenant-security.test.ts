import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, context } from '../../../utils/tenant-test-fixture';
import functionalityFactory from './functionality';
import testCaseFactory from '../../test-case/controllers/test-case';
import tenantAccess from '../../../policies/tenant-access';
import { MANAGE_ROLES } from '../../../utils/access';

for (const [name, factory] of [['functionality', functionalityFactory], ['test-case', testCaseFactory]] as const) {
  function setup() {
    const f = fixture();
    f.strapi.contentType = () => ({ kind: 'collectionType' });
    for (const entity of Object.values(f.entities)) entity.functionality = { documentId: 'feature' };
    (globalThis as any).strapi = f.strapi;
    return f;
  }
  for (const [source, error] of [['foreign', /Cross-organization/], ['viewer', /cannot perform/], ['restricted', /not assigned/]] as const) {
    test(`${name} reorder policy plus handler rejects ${source} with zero writes`, async () => {
      const f = setup();
      if (source === 'restricted') f.memberships[1].organizationRole.code = 'manager';
      const ctx: any = context(undefined, { items: [{ documentId: source, sortOrder: 1 }] }, 'POST');
      await tenantAccess(ctx, { contentTypeUid: `api::${name}.${name}`, allowedRoles: MANAGE_ROLES }, { strapi: f.strapi });
      assert.equal(ctx.request.body.data.organization, 'A');
      await assert.rejects(factory({ strapi: f.strapi }).reorder(ctx), error);
      assert.ok(!f.calls.includes('update'));
    });
  }
  test(`${name} reorder own group succeeds without altering payload`, async () => {
    const f = setup();
    f.entities.own2 = { ...f.entities.own, documentId: 'own2' };
    const data = { items: [{ documentId: 'own', sortOrder: 2 }, { documentId: 'own2', sortOrder: 1 }] };
    const original = structuredClone(data);
    const ctx: any = context(undefined, data, 'POST');
    await factory({ strapi: f.strapi }).reorder(ctx);
    assert.deepEqual(ctx.body.data.map((item: any) => item.sortOrder), [2, 1]);
    assert.deepEqual(ctx.request.body.data, original);
    assert.equal(f.calls.filter(call => call === 'update').length, 2);
  });
  test(`${name} reorder mixed group fails before first write`, async () => {
    const f = setup();
    const ctx: any = context(undefined, { items: [{ documentId: 'own', sortOrder: 1 }, { documentId: 'viewer', sortOrder: 2 }] }, 'POST');
    await assert.rejects(factory({ strapi: f.strapi }).reorder(ctx), /same project|cannot perform/);
    assert.ok(!f.calls.includes('update'));
  });
}
