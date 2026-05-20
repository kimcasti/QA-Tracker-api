import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from '@strapi/utils';
import {
  assertOrganizationFeatureAvailable,
  assertOrganizationLimitAvailable,
  assertOrganizationReportAvailable,
  countOrganizationUsageForLimit,
  getOrganizationPlanContext,
} from './plan-enforcement';

type CountKey =
  | 'api::project.project'
  | 'api::organization-membership.organization-membership'
  | 'api::organization-invitation.organization-invitation'
  | 'api::functionality.functionality'
  | 'api::test-case.test-case';

type MockOrganization = {
  documentId?: string;
  plan?: 'starter' | 'growth' | 'enterprise';
  planStatus?: 'active' | 'past_due' | 'canceled';
  gracePeriodEndsAt?: string | null;
};

function createMockStrapi(input?: {
  organization?: MockOrganization | null;
  counts?: Partial<Record<CountKey, number>>;
}) {
  const counts = {
    'api::project.project': 0,
    'api::organization-membership.organization-membership': 0,
    'api::organization-invitation.organization-invitation': 0,
    'api::functionality.functionality': 0,
    'api::test-case.test-case': 0,
    ...input?.counts,
  };

  return {
    documents(uid: string) {
      if (uid === 'api::organization.organization') {
        return {
          findOne: async ({ documentId }: { documentId: string }) => {
            if (!input?.organization?.documentId) {
              return null;
            }

            if (documentId !== input.organization.documentId) {
              return null;
            }

            return input.organization;
          },
        };
      }

      throw new Error(`Unexpected documents uid: ${uid}`);
    },
    db: {
      query(uid: CountKey) {
        return {
          count: async () => counts[uid] || 0,
        };
      },
    },
  };
}

async function withMockStrapi<T>(
  mockStrapi: ReturnType<typeof createMockStrapi>,
  run: () => Promise<T>,
) {
  const previousStrapi = (globalThis as any).strapi;
  (globalThis as any).strapi = mockStrapi;

  try {
    return await run();
  } finally {
    (globalThis as any).strapi = previousStrapi;
  }
}

test('countOrganizationUsageForLimit combines active memberships and pending invitations for user limits', async () => {
  await withMockStrapi(
    createMockStrapi({
      counts: {
        'api::organization-membership.organization-membership': 3,
        'api::organization-invitation.organization-invitation': 2,
      },
    }),
    async () => {
      const totalUsers = await countOrganizationUsageForLimit('org-1', 'users');
      assert.equal(totalUsers, 5);
    },
  );
});

test('getOrganizationPlanContext rejects unknown organizations', async () => {
  await withMockStrapi(createMockStrapi({ organization: null }), async () => {
    await assert.rejects(
      () => getOrganizationPlanContext('missing-org'),
      (error: unknown) => {
        assert.ok(error instanceof errors.NotFoundError);
        assert.equal((error as Error).message, 'Organization not found.');
        return true;
      },
    );
  });
});

test('assertOrganizationLimitAvailable returns limit context when usage is below the plan cap', async () => {
  await withMockStrapi(
    createMockStrapi({
      organization: {
        documentId: 'org-1',
        plan: 'starter',
        planStatus: 'active',
      },
      counts: {
        'api::project.project': 2,
      },
    }),
    async () => {
      const result = await assertOrganizationLimitAvailable({
        organizationDocumentId: 'org-1',
        limitKey: 'projects',
        resourceLabel: 'proyectos',
      });

      assert.equal(result.effectivePlan, 'starter');
      assert.equal(result.limit, 3);
      assert.equal(result.currentCount, 2);
    },
  );
});

test('assertOrganizationLimitAvailable blocks creation when the plan limit is already reached', async () => {
  await withMockStrapi(
    createMockStrapi({
      organization: {
        documentId: 'org-1',
        plan: 'starter',
        planStatus: 'active',
      },
      counts: {
        'api::functionality.functionality': 100,
      },
    }),
    async () => {
      await assert.rejects(
        () =>
          assertOrganizationLimitAvailable({
            organizationDocumentId: 'org-1',
            limitKey: 'features',
            resourceLabel: 'funcionalidades',
          }),
        (error: unknown) => {
          assert.ok(error instanceof errors.ForbiddenError);
          assert.match(
            (error as Error).message,
            /límite de 100 funcionalidades del plan Starter/i,
          );
          return true;
        },
      );
    },
  );
});

test('assertOrganizationLimitAvailable skips hard caps for enterprise organizations', async () => {
  await withMockStrapi(
    createMockStrapi({
      organization: {
        documentId: 'org-enterprise',
        plan: 'enterprise',
        planStatus: 'active',
      },
      counts: {
        'api::test-case.test-case': 9999,
      },
    }),
    async () => {
      const result = await assertOrganizationLimitAvailable({
        organizationDocumentId: 'org-enterprise',
        limitKey: 'testCases',
        resourceLabel: 'casos de prueba',
      });

      assert.equal(result.effectivePlan, 'enterprise');
      assert.equal(result.limit, null);
      assert.equal('currentCount' in result, false);
    },
  );
});

test('assertOrganizationFeatureAvailable rejects AI features for starter plans', async () => {
  await withMockStrapi(
    createMockStrapi({
      organization: {
        documentId: 'org-1',
        plan: 'starter',
        planStatus: 'active',
      },
    }),
    async () => {
      await assert.rejects(
        () =>
          assertOrganizationFeatureAvailable({
            organizationDocumentId: 'org-1',
            feature: 'ai',
            featureLabel: 'funciones de IA',
          }),
        (error: unknown) => {
          assert.ok(error instanceof errors.ForbiddenError);
          assert.match((error as Error).message, /no incluye funciones de IA/i);
          return true;
        },
      );
    },
  );
});

test('assertOrganizationReportAvailable allows growth-only reports when the organization plan supports them', async () => {
  await withMockStrapi(
    createMockStrapi({
      organization: {
        documentId: 'org-growth',
        plan: 'growth',
        planStatus: 'active',
      },
    }),
    async () => {
      const result = await assertOrganizationReportAvailable({
        organizationDocumentId: 'org-growth',
        report: 'qaProgress',
        reportLabel: 'reportes de progreso QA',
      });

      assert.equal(result.effectivePlan, 'growth');
      assert.equal(result.organization.documentId, 'org-growth');
    },
  );
});
