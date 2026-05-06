import { errors } from '@strapi/utils';
import {
  canUsePlanFeature,
  canUsePlanReport,
  getEffectivePlan,
  getPlanLimitValue,
  type OrganizationPlan,
  type PlanFeatureKey,
  type PlanLimitKey,
  type PlanReportKey,
} from './subscription';

function formatPlanLabel(plan: OrganizationPlan) {
  if (plan === 'growth') return 'Growth';
  if (plan === 'enterprise') return 'Enterprise';
  return 'Starter';
}

function getSuggestedUpgradePlan(plan: OrganizationPlan) {
  if (plan === 'starter') return 'Growth';
  if (plan === 'growth') return 'Enterprise';
  return null;
}

function buildUpgradeSuffix(plan: OrganizationPlan) {
  const upgradePlan = getSuggestedUpgradePlan(plan);
  return upgradePlan ? ` Actualiza a ${upgradePlan} para continuar.` : '';
}

function buildLimitReachedMessage(limit: number, resourceLabel: string, plan: OrganizationPlan) {
  const currentPlanLabel = formatPlanLabel(plan);
  return `Tu organización alcanzó el límite de ${limit} ${resourceLabel} del plan ${currentPlanLabel}.${buildUpgradeSuffix(plan)}`;
}

function buildFeatureUnavailableMessage(featureLabel: string, plan: OrganizationPlan) {
  const currentPlanLabel = formatPlanLabel(plan);
  return `Tu plan ${currentPlanLabel} no incluye ${featureLabel}.${buildUpgradeSuffix(plan)}`;
}

function buildReportUnavailableMessage(reportLabel: string, plan: OrganizationPlan) {
  const currentPlanLabel = formatPlanLabel(plan);
  return `Tu plan ${currentPlanLabel} no incluye ${reportLabel}.${buildUpgradeSuffix(plan)}`;
}

async function countProjectsForOrganization(organizationDocumentId: string) {
  return strapi.db.query('api::project.project').count({
    where: {
      organization: {
        documentId: organizationDocumentId,
      },
    },
  });
}

async function countUsersForOrganization(organizationDocumentId: string) {
  const [activeMemberships, pendingInvitations] = await Promise.all([
    strapi.db.query('api::organization-membership.organization-membership').count({
      where: {
        organization: {
          documentId: organizationDocumentId,
        },
        isActive: true,
      },
    }),
    strapi.db.query('api::organization-invitation.organization-invitation').count({
      where: {
        organization: {
          documentId: organizationDocumentId,
        },
        status: 'pending',
      },
    }),
  ]);

  return activeMemberships + pendingInvitations;
}

async function countFeaturesForOrganization(organizationDocumentId: string) {
  return strapi.db.query('api::functionality.functionality').count({
    where: {
      organization: {
        documentId: organizationDocumentId,
      },
    },
  });
}

async function countTestCasesForOrganization(organizationDocumentId: string) {
  return strapi.db.query('api::test-case.test-case').count({
    where: {
      organization: {
        documentId: organizationDocumentId,
      },
    },
  });
}

export async function countOrganizationUsageForLimit(
  organizationDocumentId: string,
  limitKey: PlanLimitKey,
) {
  if (limitKey === 'projects') {
    return countProjectsForOrganization(organizationDocumentId);
  }

  if (limitKey === 'users') {
    return countUsersForOrganization(organizationDocumentId);
  }

  if (limitKey === 'features') {
    return countFeaturesForOrganization(organizationDocumentId);
  }

  return countTestCasesForOrganization(organizationDocumentId);
}

export async function getOrganizationPlanContext(organizationDocumentId: string) {
  const organization = await strapi.documents('api::organization.organization').findOne({
    documentId: organizationDocumentId,
  });

  if (!organization?.documentId) {
    throw new errors.NotFoundError('Organization not found.');
  }

  const effectivePlan = getEffectivePlan(organization as any);
  const contractedPlan = (organization.plan || 'starter') as OrganizationPlan;

  return {
    organization,
    contractedPlan,
    effectivePlan,
  };
}

export async function assertOrganizationLimitAvailable(input: {
  organizationDocumentId: string;
  limitKey: PlanLimitKey;
  currentCount?: number;
  resourceLabel: string;
}) {
  const { organization, effectivePlan } = await getOrganizationPlanContext(input.organizationDocumentId);
  const limit = getPlanLimitValue(effectivePlan, input.limitKey);

  if (limit === null) {
    return {
      organization,
      effectivePlan,
      limit,
    };
  }

  const currentCount =
    typeof input.currentCount === 'number'
      ? input.currentCount
      : await countOrganizationUsageForLimit(input.organizationDocumentId, input.limitKey);

  if (currentCount >= limit) {
    throw new errors.ForbiddenError(buildLimitReachedMessage(limit, input.resourceLabel, effectivePlan));
  }

  return {
    organization,
    effectivePlan,
    limit,
    currentCount,
  };
}

export async function assertOrganizationFeatureAvailable(input: {
  organizationDocumentId: string;
  feature: PlanFeatureKey;
  featureLabel: string;
}) {
  const { organization, effectivePlan } = await getOrganizationPlanContext(input.organizationDocumentId);

  if (!canUsePlanFeature(effectivePlan, input.feature)) {
    throw new errors.ForbiddenError(buildFeatureUnavailableMessage(input.featureLabel, effectivePlan));
  }

  return {
    organization,
    effectivePlan,
  };
}

export async function assertOrganizationReportAvailable(input: {
  organizationDocumentId: string;
  report: PlanReportKey;
  reportLabel: string;
}) {
  const { organization, effectivePlan } = await getOrganizationPlanContext(input.organizationDocumentId);

  if (!canUsePlanReport(effectivePlan, input.report)) {
    throw new errors.ForbiddenError(buildReportUnavailableMessage(input.reportLabel, effectivePlan));
  }

  return {
    organization,
    effectivePlan,
  };
}
