import { errors } from '@strapi/utils';
import { ADMIN_ROLES } from '../../../utils/access';
import {
  PRO_PLAN_PRICE_MONTHLY_USD,
  getProjectLimitForPlan,
  normalizeOrganizationPlan,
} from '../../../utils/subscription';
import { getUserMemberships } from '../../../utils/tenant';

export default () => ({
  async workspace(userId: number) {
    const memberships = await strapi
      .documents('api::organization-membership.organization-membership')
      .findMany({
        filters: {
          user: { id: userId },
          isActive: true,
        },
        populate: {
          organization: true,
          organizationRole: true,
        },
      });

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
    const activeOrganizationDocumentId = activeMembership?.organization?.documentId;
    const activeRoleCode = activeMembership?.organizationRole?.code || '';
    const activeOrganizationPlan = normalizeOrganizationPlan(activeMembership?.organization?.plan);
    const activeOrganizationProjectCount = activeOrganizationDocumentId
      ? projects.filter(project => project.organization?.documentId === activeOrganizationDocumentId).length
      : 0;
    const projectLimit = getProjectLimitForPlan(activeOrganizationPlan);
    const allowedByRole = ADMIN_ROLES.includes(activeRoleCode as any);
    const limitReached =
      projectLimit !== null && activeOrganizationProjectCount >= projectLimit;

    return {
      user: {
        id: user?.id,
        username: user?.username,
        email: user?.email,
      },
      memberships: memberships.map((membership) => ({
        documentId: membership.documentId,
        organization: membership.organization,
        role: membership.organizationRole,
      })),
      projects,
      projectQuota: {
        plan: activeOrganizationPlan,
        currentCount: activeOrganizationProjectCount,
        limit: projectLimit,
        allowedByRole,
        canCreate: allowedByRole && !limitReached,
        limitReached,
        upgradePriceMonthlyUsd: PRO_PLAN_PRICE_MONTHLY_USD,
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
