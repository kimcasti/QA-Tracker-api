import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from '@strapi/utils';
import { createTestCaseController } from './test-case';

function createCtx(data: Record<string, unknown>, userId = 8) {
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
    params: {},
    body: undefined as unknown,
  };
}

test('test-case create requires a functionality linked to the selected project', async () => {
  let limitCheckCount = 0;

  const controller = createTestCaseController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::functionality.functionality') {
          return {
            findFirst: async () => null,
          };
        }

        if (uid === 'api::test-case.test-case') {
          return {
            create: async () => ({ documentId: 'tc-1' }),
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
      service() {
        throw new Error('service() should not be called in this test');
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
    title: 'Caso login',
    project: 'proj-1',
    functionality: 'AUTH-99',
  });

  await assert.rejects(() => controller.create(ctx as any), (error: unknown) => {
    assert.ok(error instanceof errors.ValidationError);
    assert.equal((error as Error).message, 'Test case functionality is required.');
    return true;
  });

  assert.equal(limitCheckCount, 0);
});

test('test-case create stops when the plan limit is reached', async () => {
  let createdPayload: Record<string, unknown> | null = null;

  const controller = createTestCaseController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::functionality.functionality') {
          return {
            findFirst: async ({ filters }: Record<string, any>) =>
              filters?.documentId === 'func-1' ? { documentId: 'func-1' } : null,
          };
        }

        if (uid === 'api::test-case.test-case') {
          return {
            create: async (input: Record<string, unknown>) => {
              createdPayload = input;
              return { documentId: 'tc-2' };
            },
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
      service() {
        throw new Error('service() should not be called in this test');
      },
    } as any,
    dependencies: {
      getUserMemberships: async () =>
        [{ organization: { documentId: 'org-1' }, organizationRole: { code: 'qa-lead' } }] as any,
      getAllowedOrganizationDocumentIds: () => ['org-1'],
      getOrganizationDocumentIdFromPayload: async () => 'org-1',
      assertOrganizationLimitAvailable: async () => {
        throw new errors.ForbiddenError('Test case limit reached.');
      },
    },
  });

  const ctx = createCtx({
    title: 'Caso login',
    project: 'proj-1',
    functionality: 'func-1',
  });

  await assert.rejects(() => controller.create(ctx as any), (error: unknown) => {
    assert.ok(error instanceof errors.ForbiddenError);
    assert.equal((error as Error).message, 'Test case limit reached.');
    return true;
  });

  assert.equal(createdPayload, null);
});

test('test-case create resolves functionality by code and persists normalized payload', async () => {
  let createdPayload: Record<string, any> | null = null;

  const controller = createTestCaseController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::functionality.functionality') {
          return {
            findFirst: async ({ filters }: Record<string, any>) => {
              if (filters?.documentId === 'AUTH-01') {
                return null;
              }

              if (filters?.code === 'AUTH-01') {
                return { documentId: 'func-auth-01' };
              }

              return null;
            },
          };
        }

        if (uid === 'api::test-case.test-case') {
          return {
            create: async (input: Record<string, unknown>) => {
              createdPayload = input;
              return { documentId: 'tc-3', title: 'Caso login' };
            },
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
      service() {
        throw new Error('service() should not be called in this test');
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
    title: 'Caso login',
    description: 'Valida acceso',
    project: { documentId: 'proj-1' },
    functionality: 'AUTH-01',
    priority: 'high',
    isAutomated: true,
  });

  await controller.create(ctx as any);

  assert.deepEqual(createdPayload?.data, {
    title: 'Caso login',
    description: 'Valida acceso',
    preconditions: '',
    testSteps: '',
    expectedResult: '',
    testType: 'functional',
    priority: 'high',
    isAutomated: true,
    organization: 'org-1',
    project: 'proj-1',
    functionality: 'func-auth-01',
  });
  assert.deepEqual(ctx.body, {
    data: { documentId: 'tc-3', title: 'Caso login' },
  });
});
