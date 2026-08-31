import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from '@strapi/utils';
import { createFunctionalityController } from './functionality';

function createCtx(data: Record<string, unknown>, userId = 7) {
  return {
    state: {
      user: {
        id: userId,
      },
    },
    request: {
      body: {
        data,
      },
    },
    body: undefined as unknown,
  };
}

test('functionality create enforces plan limits before creating records', async () => {
  let createdPayload: Record<string, unknown> | null = null;
  let limitCheckCount = 0;

  const controller = createFunctionalityController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::functionality.functionality') {
          return {
            findMany: async () => [],
            create: async (input: Record<string, unknown>) => {
              createdPayload = input;
              return { documentId: 'func-1' };
            },
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
    } as any,
    dependencies: {
      getUserMemberships: async () =>
        [{ organization: { documentId: 'org-1' }, organizationRole: { code: 'qa-lead' } }] as any,
      getAllowedOrganizationDocumentIds: () => ['org-1'],
      getOrganizationDocumentIdFromPayload: async () => 'org-1',
      assertOrganizationLimitAvailable: async () => {
        limitCheckCount += 1;
        throw new errors.ForbiddenError('Feature limit reached.');
      },
    },
  });

  const ctx = createCtx({
    code: 'AUTH-01',
    name: 'Login',
    project: 'proj-1',
  });

  await assert.rejects(() => controller.create(ctx as any), (error: unknown) => {
    assert.ok(error instanceof errors.ForbiddenError);
    assert.equal((error as Error).message, 'Feature limit reached.');
    return true;
  });

  assert.equal(limitCheckCount, 1);
  assert.equal(createdPayload, null);
});

test('functionality create rejects duplicate codes within the same project', async () => {
  let limitCheckCount = 0;

  const controller = createFunctionalityController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::functionality.functionality') {
          return {
            findMany: async () => [{ documentId: 'func-existing', code: 'AUTH-01' }],
            create: async () => ({ documentId: 'func-2' }),
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
    } as any,
    dependencies: {
      getUserMemberships: async () =>
        [{ organization: { documentId: 'org-1' }, organizationRole: { code: 'qa-lead' } }] as any,
      getAllowedOrganizationDocumentIds: () => ['org-1'],
      getOrganizationDocumentIdFromPayload: async () => 'org-1',
      assertOrganizationLimitAvailable: async () => {
        limitCheckCount += 1;
      },
    },
  });

  const ctx = createCtx({
    code: 'AUTH-01',
    name: 'Login',
    project: 'proj-1',
  });

  await assert.rejects(() => controller.create(ctx as any), (error: unknown) => {
    assert.ok(error instanceof errors.ValidationError);
    assert.match((error as Error).message, /already exists in this project/i);
    return true;
  });

  assert.equal(limitCheckCount, 0);
});

test('functionality create persists normalized data when validation passes', async () => {
  let createdPayload: Record<string, any> | null = null;

  const controller = createFunctionalityController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::functionality.functionality') {
          return {
            findMany: async () => [],
            create: async (input: Record<string, unknown>) => {
              createdPayload = input;
              return { documentId: 'func-3', code: 'AUTH-02', name: 'Registro' };
            },
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
    } as any,
    dependencies: {
      getUserMemberships: async () =>
        [{ organization: { documentId: 'org-1' }, organizationRole: { code: 'qa-lead' } }] as any,
      getAllowedOrganizationDocumentIds: () => ['org-1'],
      getOrganizationDocumentIdFromPayload: async () => null,
      assertOrganizationLimitAvailable: async () => ({ effectivePlan: 'starter' }),
    },
  });

  const ctx = createCtx({
    code: ' AUTH-02 ',
    name: 'Registro',
    project: { documentId: 'proj-1' },
    personaRoles: {
      connect: [{ documentId: 'role-1' }, { documentId: '' }, { documentId: 'role-2' }],
    },
  });

  await controller.create(ctx as any);

  assert.deepEqual(createdPayload?.data, {
    code: 'AUTH-02',
    name: 'Registro',
    jiraIssueKey: null,
    jiraTaskUrl: null,
    jiraIssueType: null,
    testTypes: [],
    isCore: false,
    isRegression: false,
    isSmoke: false,
    lastFunctionalChangeAt: null,
    deliveryDate: null,
    status: 'backlog',
    priority: 'medium',
    impactLevel: 'medium',
    probabilityLevel: 'medium',
    storyLegacyId: null,
    sortOrder: 0,
    personaRoles: {
      connect: [{ documentId: 'role-1' }, { documentId: 'role-2' }],
    },
    organization: 'org-1',
    project: 'proj-1',
  });
  assert.deepEqual(ctx.body, {
    data: { documentId: 'func-3', code: 'AUTH-02', name: 'Registro' },
  });
});

test('functionality create accepts an empty persona role set', async () => {
  let createdPayload: Record<string, any> | null = null;

  const controller = createFunctionalityController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::functionality.functionality') {
          return {
            findMany: async () => [],
            create: async (input: Record<string, unknown>) => {
              createdPayload = input;
              return { documentId: 'func-4', code: 'AUTH-03', name: 'Perfil' };
            },
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
    } as any,
    dependencies: {
      getUserMemberships: async () =>
        [{ organization: { documentId: 'org-1' }, organizationRole: { code: 'qa-lead' } }] as any,
      getAllowedOrganizationDocumentIds: () => ['org-1'],
      getOrganizationDocumentIdFromPayload: async () => null,
      assertOrganizationLimitAvailable: async () => ({ effectivePlan: 'starter' }),
    },
  });

  const ctx = createCtx({
    code: 'AUTH-03',
    name: 'Perfil',
    project: { documentId: 'proj-1' },
    personaRoles: {
      set: [],
    },
  });

  await controller.create(ctx as any);

  assert.deepEqual(createdPayload?.data?.personaRoles, {
    set: [],
  });
});

test('functionality reorder updates only the requested sort orders for the same project', async () => {
  const updates: Array<{ documentId: string; data: Record<string, unknown> }> = [];

  const records = new Map([
    [
      'func-1',
      {
        documentId: 'func-1',
        code: 'AUTH-01',
        sortOrder: 0,
        project: { documentId: 'proj-1' },
        organization: { documentId: 'org-1' },
      },
    ],
    [
      'func-2',
      {
        documentId: 'func-2',
        code: 'AUTH-02',
        sortOrder: 1,
        project: { documentId: 'proj-1' },
        organization: { documentId: 'org-1' },
      },
    ],
  ]);

  const controller = createFunctionalityController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::functionality.functionality') {
          return {
            findOne: async ({ documentId }: { documentId: string }) => records.get(documentId) ?? null,
            update: async ({
              documentId,
              data,
            }: {
              documentId: string;
              data: Record<string, unknown>;
            }) => {
              updates.push({ documentId, data });
              return { documentId, ...data };
            },
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
    } as any,
    dependencies: {
      getUserMemberships: async () =>
        [{ organization: { documentId: 'org-1' }, organizationRole: { code: 'qa-lead' } }] as any,
      getAllowedOrganizationDocumentIds: () => ['org-1'],
      getOrganizationDocumentIdFromPayload: async () => 'org-1',
    },
  });

  const ctx = createCtx({
    items: [
      { documentId: 'func-1', sortOrder: 1 },
      { documentId: 'func-2', sortOrder: 0 },
    ],
  });

  await controller.reorder(ctx as any);

  assert.deepEqual(updates, [
    {
      documentId: 'func-1',
      data: {
        sortOrder: 1,
        organization: 'org-1',
        project: 'proj-1',
      },
    },
    {
      documentId: 'func-2',
      data: {
        sortOrder: 0,
        organization: 'org-1',
        project: 'proj-1',
      },
    },
  ]);
});

test('functionality reorder rejects mixed-project payloads', async () => {
  const records = new Map([
    [
      'func-1',
      {
        documentId: 'func-1',
        project: { documentId: 'proj-1' },
        organization: { documentId: 'org-1' },
      },
    ],
    [
      'func-2',
      {
        documentId: 'func-2',
        project: { documentId: 'proj-2' },
        organization: { documentId: 'org-1' },
      },
    ],
  ]);

  const controller = createFunctionalityController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::functionality.functionality') {
          return {
            findOne: async ({ documentId }: { documentId: string }) => records.get(documentId) ?? null,
            update: async () => {
              throw new Error('Update should not be called for mixed-project payloads.');
            },
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
    } as any,
    dependencies: {
      getUserMemberships: async () =>
        [{ organization: { documentId: 'org-1' }, organizationRole: { code: 'qa-lead' } }] as any,
      getAllowedOrganizationDocumentIds: () => ['org-1'],
      getOrganizationDocumentIdFromPayload: async () => 'org-1',
    },
  });

  const ctx = createCtx({
    items: [
      { documentId: 'func-1', sortOrder: 1 },
      { documentId: 'func-2', sortOrder: 0 },
    ],
  });

  await assert.rejects(() => controller.reorder(ctx as any), (error: unknown) => {
    assert.ok(error instanceof errors.ValidationError);
    assert.match((error as Error).message, /same project and organization/i);
    return true;
  });
});
