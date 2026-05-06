import { errors } from '@strapi/utils';
import { ADMIN_ROLES } from '../../../utils/access';
import {
  PRO_PLAN_PRICE_MONTHLY_USD,
  getAIUsageStatus,
  getExportUsageStatus,
  getEffectivePlan,
  canUsePlanFeature,
  canUsePlanReport,
  getPlanLimitValue,
  getPlanMonthlyAllowanceValue,
  getProjectLimitForPlan,
  isInGracePeriod,
  normalizeOrganizationPlan,
  shouldDowngradeToStarter,
} from '../../../utils/subscription';
import { getUserMemberships } from '../../../utils/tenant';

export default () => ({
  async organizationUsage(userId: number) {
    return strapi.service('api::organization-usage.organization-usage').currentForUser(userId, true);
  },

  async projectContexts(userId: number) {
    const memberships = await getUserMemberships(strapi, userId);

    const organizationDocumentIds = memberships
      .map(membership => membership.organization?.documentId)
      .filter(Boolean);

    const projects = organizationDocumentIds.length
      ? await strapi.documents('api::project.project').findMany({
          filters: {
            organization: {
              documentId: {
                $in: organizationDocumentIds,
              },
            },
          },
          fields: ['documentId', 'key'],
          populate: {
            organization: {
              fields: ['documentId', 'name'],
            },
          },
          sort: ['name:asc'],
        })
      : [];

    return {
      projects: projects.map(project => ({
        documentId: project.documentId,
        key: project.key,
        organization: project.organization
          ? {
              documentId: project.organization.documentId,
              name: project.organization.name,
            }
          : undefined,
      })),
    };
  },

  async workspace(userId: number) {
    const memberships = await getUserMemberships(strapi, userId);

    const organizationDocumentIds = memberships
      .map((membership) => membership.organization?.documentId)
      .filter(Boolean);

    const projects = organizationDocumentIds.length
      ? await strapi.documents('api::project.project').findMany({
          filters: {
            organization: {
              documentId: {
                $in: organizationDocumentIds,
              },
            },
          },
          populate: {
            organization: true,
          },
          sort: ['name:asc'],
        })
      : [];

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId },
      populate: ['role'],
    });

    const activeMembership = memberships[0];
    const activeOrganization = activeMembership?.organization as any;
    const activeOrganizationDocumentId = activeMembership?.organization?.documentId;
    const activeRoleCode = activeMembership?.organizationRole?.code || '';
    const contractedOrganizationPlan = normalizeOrganizationPlan(activeOrganization?.plan);
    const effectiveOrganizationPlan = getEffectivePlan(activeOrganization);
    const aiUsageStatus = getAIUsageStatus(activeOrganization);
    const exportUsageStatus = getExportUsageStatus(activeOrganization);
    const activeOrganizationProjectCount = activeOrganizationDocumentId
      ? projects.filter(project => project.organization?.documentId === activeOrganizationDocumentId).length
      : 0;
    const organizationUsageSnapshot = activeOrganizationDocumentId
      ? await strapi
          .service('api::organization-usage.organization-usage')
          .currentForOrganization(activeOrganizationDocumentId, true)
      : null;
    const organizationUsage = {
      projects: organizationUsageSnapshot?.projectsCount || 0,
      users: organizationUsageSnapshot?.usersCount || 0,
      features: organizationUsageSnapshot?.functionalitiesCount || 0,
      testCases: organizationUsageSnapshot?.testCasesCount || 0,
    };
    const projectLimit = getProjectLimitForPlan(effectiveOrganizationPlan);
    const allowedByRole = ADMIN_ROLES.includes(activeRoleCode as any);
    const limitReached =
      projectLimit !== null && activeOrganizationProjectCount >= projectLimit;

    return {
      user: {
        id: user?.id,
        username: user?.username,
        email: user?.email,
        isSuperAdmin: Boolean(user?.isSuperAdmin),
      },
      memberships: memberships.map((membership) => ({
        documentId: membership.documentId,
        organization: membership.organization,
        role: membership.organizationRole,
      })),
      projects,
      projectQuota: {
        plan: contractedOrganizationPlan,
        effectivePlan: effectiveOrganizationPlan,
        currentCount: activeOrganizationProjectCount,
        limit: projectLimit,
        limits: {
          projects: getPlanLimitValue(effectiveOrganizationPlan, 'projects'),
          users: getPlanLimitValue(effectiveOrganizationPlan, 'users'),
          features: getPlanLimitValue(effectiveOrganizationPlan, 'features'),
          testCases: getPlanLimitValue(effectiveOrganizationPlan, 'testCases'),
          aiRequests: getPlanMonthlyAllowanceValue(effectiveOrganizationPlan, 'aiRequests'),
          exports: getPlanMonthlyAllowanceValue(effectiveOrganizationPlan, 'exports'),
        },
        usage: {
          projects: organizationUsage.projects,
          users: organizationUsage.users,
          features: organizationUsage.features,
          testCases: organizationUsage.testCases,
          aiRequests: aiUsageStatus.usedThisMonth,
          exports: exportUsageStatus.usedThisMonth,
        },
        allowedByRole,
        canCreate: allowedByRole && !limitReached,
        limitReached,
        upgradePriceMonthlyUsd: PRO_PLAN_PRICE_MONTHLY_USD,
        features: {
          ai: canUsePlanFeature(effectiveOrganizationPlan, 'ai'),
          templates: canUsePlanFeature(effectiveOrganizationPlan, 'templates'),
          audit: canUsePlanFeature(effectiveOrganizationPlan, 'audit'),
          exports: canUsePlanFeature(effectiveOrganizationPlan, 'exports'),
        },
        billing: {
          planStatus: activeOrganization?.planStatus || 'active',
          planExpiresAt: activeOrganization?.planExpiresAt || null,
          gracePeriodEndsAt: activeOrganization?.gracePeriodEndsAt || null,
          planUpdatedAt: activeOrganization?.planUpdatedAt || null,
          billingNotes: activeOrganization?.billingNotes || null,
          inGracePeriod: isInGracePeriod(activeOrganization),
          downgradedToStarter: shouldDowngradeToStarter(activeOrganization),
        },
        aiUsage: {
          usedThisMonth: aiUsageStatus.usedThisMonth,
          resetAt: aiUsageStatus.resetAt?.toISOString() || null,
          limit: aiUsageStatus.limit,
          remaining: aiUsageStatus.remaining,
          unlimited: aiUsageStatus.unlimited,
          canUse: aiUsageStatus.canUse,
          nearLimit: aiUsageStatus.nearLimit,
          reachedLimit: aiUsageStatus.reachedLimit,
        },
        exportUsage: {
          usedThisMonth: exportUsageStatus.usedThisMonth,
          resetAt: exportUsageStatus.resetAt?.toISOString() || null,
          limit: exportUsageStatus.limit,
          remaining: exportUsageStatus.remaining,
          unlimited: exportUsageStatus.unlimited,
          canUse: exportUsageStatus.canUse,
          nearLimit: exportUsageStatus.nearLimit,
          reachedLimit: exportUsageStatus.reachedLimit,
        },
        reports: {
          qaStatusSummary: canUsePlanReport(effectiveOrganizationPlan, 'qaStatusSummary'),
          qaProgress: canUsePlanReport(effectiveOrganizationPlan, 'qaProgress'),
          executiveProjectStatus: canUsePlanReport(effectiveOrganizationPlan, 'executiveProjectStatus'),
        },
        organizationUsage: organizationUsageSnapshot,
      },
    };
  },

  async updateOrganization(userId: number, name: string) {
    const normalizedName = (name || '').trim();

    if (!normalizedName) {
      throw new errors.ValidationError('Organization name is required.');
    }

    const memberships = await getUserMemberships(strapi, userId);
    const activeMembership = memberships[0];

    if (!activeMembership?.organization?.documentId) {
      throw new errors.ForbiddenError('An active organization membership is required.');
    }

    if (!ADMIN_ROLES.includes((activeMembership.organizationRole?.code || '') as any)) {
      throw new errors.ForbiddenError('Only Owner or QA Lead can edit the organization.');
    }

    const updated = await strapi.documents('api::organization.organization').update({
      documentId: activeMembership.organization.documentId,
      data: {
        name: normalizedName,
      },
    });

    return {
      documentId: updated.documentId,
      name: updated.name,
      slug: updated.slug,
    };
  },
});
