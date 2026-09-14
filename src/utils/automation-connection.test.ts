import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSecret, isActiveConnection, assertConnectionProject, readConnection } from './automation-connection';
import tokenPolicy from '../policies/automation-token';
import sessionPolicy from '../policies/automation-session';
import ingestion, { ensureEngineeringProjectAccess } from '../api/automation-ingestion/controllers/automation-ingestion';
import controller from '../api/automation-connection/controllers/automation-connection';

const token = `qat_${'a'.repeat(64)}`;
const project = { documentId: 'lpas', key: 'LPAS', organization: { documentId: 'org' } };
const ctx = (body = {}) => ({ ip: 'test', request: { headers: { authorization: `Bearer ${token}` }, body: { data: body } }, state: {} as any, set() {}, body: null as any });
const membership = (org = 'org', role = 'owner') => ({ documentId: org, isActive: true, organization: { documentId: org, status: 'active' }, organizationRole: { code: role } });

test('project binding is enforced and legacy sessions remain supported', () => {
  assert.doesNotThrow(() => assertConnectionProject({ state: {} }, 'other'));
  assert.doesNotThrow(() => assertConnectionProject({ state: { automationConnection: { projectId: 'lpas' } } }, 'lpas'));
  assert.throws(() => assertConnectionProject({ state: { automationConnection: { projectId: 'lpas' } } }, 'other'), /otro proyecto/);
  for (const state of ['pending', 'revoked']) assert.equal(isActiveConnection({ state, expiresAt: '2099-01-01' }), false);
  assert.equal(isActiveConnection({ state: 'active', expiresAt: '2000-01-01' }), false);
});

test('limited credentials check hash, expiry, blocked users and current project access', async () => {
  let row: any = { state: 'active', projectId: 'lpas', userId: 2, expiresAt: '2099-01-01' };
  let blocked = false;
  let memberships = [membership()];
  (globalThis as any).strapi = {
    db: { query: (uid: string) => ({ findOne: async (query: any) => {
      if (uid.includes('automation-connection')) { assert.equal(query.where.tokenHash, hashSecret(token)); return row; }
      return { id: 2, confirmed: true, blocked, email: 'test@example.invalid' };
    } }) },
    documents: (uid: string) => ({ findMany: async () => uid.includes('membership') ? memberships : [], findFirst: async () => project }),
  };
  const context = ctx();
  assert.equal(await tokenPolicy(context), true);
  assert.equal(context.state.automationConnection.projectId, 'lpas');
  row.state = 'pending'; await assert.rejects(tokenPolicy(ctx()), /Autoriza/);
  row.state = 'revoked'; await assert.rejects(readConnection(ctx()), /revocada/);
  row.state = 'active'; row.expiresAt = '2000-01-01'; await assert.rejects(readConnection(ctx()), /venció/);
  row.expiresAt = '2099-01-01'; blocked = true; await assert.rejects(tokenPolicy(ctx()), /Cuenta/);
  blocked = false; memberships = [membership('other')]; await assert.rejects(tokenPolicy(ctx()), /Cross-organization/);
  memberships = [membership('org', 'viewer'), membership('other')];
  await assert.rejects(ensureEngineeringProjectAccess(2, project), /engineering/);
});

test('both ingestion endpoints reject a different project before making writes', async () => {
  const other = { ...project, documentId: 'other', key: 'OTHER' };
  (globalThis as any).strapi = {
    documents: (uid: string) => ({
      findFirst: async () => other,
      findMany: async () => [membership()],
      findOne: async () => ({ documentId: 'run-other', project: other }),
      create: async () => assert.fail('Must not create a run'),
      update: async () => assert.fail('Must not update results'),
    }),
  };
  const context = ctx({ projectKey: 'OTHER', testRunDocumentId: 'run-other' });
  context.state = { user: { id: 2 }, automationConnection: { projectId: 'lpas' } };
  await assert.rejects(ingestion.openRun(context), /otro proyecto/);
  await assert.rejects(ingestion.publishResults(context), /otro proyecto/);
});

test('approval is a single conditional transition and revoke is owner-scoped', async () => {
  let pending = true;
  let update: any;
  (globalThis as any).strapi = {
    documents: () => ({ findFirst: async () => project, findMany: async () => [membership()] }),
    db: { query: () => ({ updateMany: async (input: any) => { update = input; if (!pending) return { count: 0 }; pending = false; return { count: 1 }; } }) },
  };
  const context = ctx({ code: 'ABCDEF0123456789', projectKey: 'LPAS' });
  context.state = { user: { id: 2 } };
  await controller.approve(context);
  assert.equal(update.where.state, 'pending');
  assert.ok(update.where.expiresAt.$gt);
  assert.equal(update.data.code, null);
  assert.equal(update.data.userId, 2);
  await assert.rejects(controller.approve(context), /ya se utilizó/);
  await controller.revoke({ ...context, params: { id: '19' } });
  assert.deepEqual(update.where, { id: '19', userId: 2 });
});

test('session management rejects signed tokens without a user id', async () => {
  (globalThis as any).strapi = {
    plugin: () => ({ service: () => ({ verify: async () => ({}) }) }),
    db: { query: () => ({ findOne: async () => assert.fail('Missing id must never query users') }) },
  };
  await assert.rejects(sessionPolicy(ctx()), /Inicia sesión/);
});
