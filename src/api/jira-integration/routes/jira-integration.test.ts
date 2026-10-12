import assert from 'node:assert/strict';
import { test } from 'node:test';
import routes from './jira-integration';
import userSession from '../../../policies/user-session';
import hasActiveMembership from '../../../policies/has-active-membership';
import controller from '../controllers/jira-integration';

test('Jira routes validate user sessions and project roles independently of the global role', async () => {
  const originalStrapi = (global as any).strapi;
  const originalFetch = global.fetch;
  let user: any = { id: 7, confirmed: true, blocked: false, role: { type: 'custom-qa' } };
  let tokenValid = true;
  let memberships: any[] = [{ isActive: true, organization: { documentId: 'org', status: 'active' }, organizationRole: { code: 'qa-engineer' } }];
  const backend: any = {
    plugin: () => ({ service: () => ({ verify: async (token: string) => {
      if (!tokenValid || token !== 'valid-user-jwt') throw new Error('Invalid JWT');
      return { id: 7 };
    } }) }),
    documents: (uid: string) => ({
      findMany: async () => memberships,
      findFirst: async () => {
        assert.equal(uid, 'api::project.project');
        return { documentId: 'project', organization: { documentId: 'org' } };
      },
    }),
    db: { query: (uid: string) => ({ findOne: async () => uid === 'plugin::users-permissions.user' ? user : null }) },
  };
  (global as any).strapi = backend;
  global.fetch = (async () => { throw new Error('No Jira requests expected'); }) as typeof fetch;
  const context = () => ({ state: {} as any, request: { headers: { authorization: 'Bearer valid-user-jwt' } }, params: { projectKey: 'QA' }, body: undefined as any });
  try {
    for (const route of routes.routes) {
      assert.equal(route.config.auth, false);
      assert.deepEqual(route.config.policies, ['global::user-session', 'global::has-active-membership']);
    }
    const ctx = context();
    assert.equal(await userSession(ctx), true);
    assert.equal(await hasActiveMembership(ctx, undefined, { strapi: backend }), true);
    await controller.status(ctx);
    assert.equal(ctx.body.data.configured, false);

    // A valid JWT never grants access to another organization or to admin actions.
    await assert.rejects(controller.projects(ctx), { name: 'ForbiddenError' });
    memberships[0].organization.documentId = 'other-org';
    await assert.rejects(controller.status(ctx), { name: 'ForbiddenError' });
    memberships[0].organization.documentId = 'org';
    memberships[0].organizationRole.code = 'viewer';
    await assert.rejects(controller.status(ctx), { name: 'ForbiddenError' });

    user = { ...user, blocked: true };
    await assert.rejects(userSession(context()), { name: 'UnauthorizedError' });
    user = { ...user, blocked: false, confirmed: false };
    await assert.rejects(userSession(context()), { name: 'UnauthorizedError' });
    user = null;
    await assert.rejects(userSession(context()), { name: 'UnauthorizedError' });
    tokenValid = false;
    await assert.rejects(userSession(context()), { name: 'UnauthorizedError' });
  } finally {
    (global as any).strapi = originalStrapi;
    global.fetch = originalFetch;
  }
});
