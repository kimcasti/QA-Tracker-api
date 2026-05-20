import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from '@strapi/utils';
import { createProjectController } from './project';

function createCtx(data: Record<string, unknown>, userId = 12) {
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

test('project create rejects non-admin roles before checking plan limits', async () => {
  let limitCheckCount = 0;

  const controller = createProjectController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::organization.organization') {
          return {
            findOne: async () => ({ documentId: 'org-1', plan: 'starter', planStatus: 'active' }),
          };
        }

        if (uid === 'api::project.project') {
          return {
            create: async () => ({ documentId: 'proj-1' }),
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
    } as any,
    dependencies: {
      getUserMemberships: async () =>
        [{ organization: { documentId: 'org-1' }, organizationRole: { code: 'viewer' } }] as any,
      assertOrganizationLimitAvailable: async () => {
        limitCheckCount += 1;
      },
    },
  });

  await assert.rejects(
    () => controller.create(createCtx({ name: 'Portal', organization: 'org-1' }) as any),
    (error: unknown) => {
      assert.ok(error instanceof errors.ForbiddenError);
      assert.equal((error as Error).message, 'Only Owner or QA Lead can create projects.');
      return true;
    },
  );

  assert.equal(limitCheckCount, 0);
});

test('project create blocks AI payloads when the plan does not include AI', async () => {
  let createCount = 0;

  const controller = createProjectController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::organization.organization') {
          return {
            findOne: async () => ({ documentId: 'org-1', plan: 'starter', planStatus: 'active' }),
          };
        }

        if (uid === 'api::project.project') {
          return {
            create: async () => {
              createCount += 1;
              return { documentId: 'proj-2' };
            },
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
    } as any,
    dependencies: {
      getUserMemberships: async () =>
        [{ organization: { documentId: 'org-1' }, organizationRole: { code: 'owner' } }] as any,
      assertOrganizationLimitAvailable: async () => ({ effectivePlan: 'starter' }),
      assertOrganizationFeatureAvailable: async () => {
        throw new errors.ForbiddenError('AI feature unavailable.');
      },
    },
  });

  await assert.rejects(
    () =>
      controller.create(
        createCtx({
          name: 'Portal',
          organization: 'org-1',
          aiProjectInsights: 'Resumen generado',
        }) as any,
      ),
    (error: unknown) => {
      assert.ok(error instanceof errors.ForbiddenError);
      assert.equal((error as Error).message, 'AI feature unavailable.');
      return true;
    },
  );

  assert.equal(createCount, 0);
});

test('project create persists normalized payload for authorized users', async () => {
  let createdPayload: Record<string, any> | null = null;

  const controller = createProjectController({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::organization.organization') {
          return {
            findOne: async () => ({ documentId: 'org-1', plan: 'growth', planStatus: 'active' }),
          };
        }

        if (uid === 'api::project.project') {
          return {
            create: async (input: Record<string, unknown>) => {
              createdPayload = input;
              return { documentId: 'proj-3', name: 'Portal' };
            },
          };
        }

        throw new Error(`Unexpected uid: ${uid}`);
      },
    } as any,
    dependencies: {
      getUserMemberships: async () =>
        [{ organization: { documentId: 'org-1' }, organizationRole: { code: 'qa-lead' } }] as any,
      assertOrganizationLimitAvailable: async () => ({ effectivePlan: 'growth' }),
      assertOrganizationFeatureAvailable: async () => ({ effectivePlan: 'growth' }),
    },
  });

  const ctx = createCtx({
    name: 'Portal',
    key: 'PORT',
    organization: 'org-1',
    teamMembers: ['kim', 'sam'],
    coreRequirements: ['auth', 'qa'],
    serviceBillingPhases: [{ name: 'descubrimiento' }],
    paymentTermsDays: 15,
    aiProjectInsights: 'Resumen',
  });

  await controller.create(ctx as any);

  assert.deepEqual(createdPayload?.data, {
    name: 'Portal',
    key: 'PORT',
    description: '',
    version: '',
    status: 'active',
    icon: '',
    logoDataUrl: null,
    teamMembers: ['kim', 'sam'],
    purpose: '',
    coreRequirements: ['auth', 'qa'],
    businessRules: '',
    aiProjectInsights: 'Resumen',
    aiWireframeBrief: '',
    serviceBillingPhases: JSON.stringify([{ name: 'descubrimiento' }]),
    proposalType: null,
    proposalSentAt: null,
    projectStartAt: null,
    contractNumber: null,
    proposalNumber: null,
    currency: null,
    paymentTermsDays: 15,
    proposalOwner: null,
    organization: 'org-1',
  });
  assert.deepEqual(ctx.body, {
    data: { documentId: 'proj-3', name: 'Portal' },
  });
});
