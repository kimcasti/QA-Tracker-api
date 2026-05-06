import { getCurrentUsageMonthKey, getUsagePeriodEnd, getUsagePeriodStart } from './billing-period';

async function countProjectsForOrganization(organizationDocumentId: string) {
  return strapi.db.query('api::project.project').count({
    where: {
      organization: {
        documentId: organizationDocumentId,
      },
    },
  });
}

async function countActiveMembershipsForOrganization(organizationDocumentId: string) {
  return strapi.db.query('api::organization-membership.organization-membership').count({
    where: {
      organization: {
        documentId: organizationDocumentId,
      },
      isActive: true,
    },
  });
}

async function countPendingInvitationsForOrganization(organizationDocumentId: string) {
  return strapi.db.query('api::organization-invitation.organization-invitation').count({
    where: {
      organization: {
        documentId: organizationDocumentId,
      },
      status: 'pending',
    },
  });
}

async function countFunctionalitiesForOrganization(organizationDocumentId: string) {
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

export async function recomputeOrganizationUsageSnapshot(
  organizationDocumentId: string,
  now: Date = new Date(),
) {
  const monthKey = getCurrentUsageMonthKey(now);
  const [
    organization,
    projectsCount,
    activeMembershipsCount,
    pendingInvitationsCount,
    functionalitiesCount,
    testCasesCount,
  ] = await Promise.all([
    strapi.documents('api::organization.organization').findOne({
      documentId: organizationDocumentId,
      fields: ['documentId', 'aiUsageThisMonth', 'exportUsageThisMonth'] as any,
    }),
    countProjectsForOrganization(organizationDocumentId),
    countActiveMembershipsForOrganization(organizationDocumentId),
    countPendingInvitationsForOrganization(organizationDocumentId),
    countFunctionalitiesForOrganization(organizationDocumentId),
    countTestCasesForOrganization(organizationDocumentId),
  ]);

  if (!organization?.documentId) {
    return null;
  }

  const existingSnapshot = await strapi.documents('api::organization-usage.organization-usage' as any).findFirst({
    filters: {
      organization: {
        documentId: organizationDocumentId,
      },
      monthKey,
    },
    fields: ['documentId'],
  });

  const payload = {
    monthKey,
    periodStart: getUsagePeriodStart(now).toISOString(),
    periodEnd: getUsagePeriodEnd(now).toISOString(),
    projectsCount,
    usersCount: activeMembershipsCount + pendingInvitationsCount,
    functionalitiesCount,
    testCasesCount,
    aiUsageCount: Math.max(0, Number((organization as any).aiUsageThisMonth || 0)),
    exportUsageCount: Math.max(0, Number((organization as any).exportUsageThisMonth || 0)),
    lastRecomputedAt: now.toISOString(),
    organization: organizationDocumentId,
  };

  if (existingSnapshot?.documentId) {
    return strapi.documents('api::organization-usage.organization-usage' as any).update({
      documentId: existingSnapshot.documentId,
      data: payload,
    });
  }

  return strapi.documents('api::organization-usage.organization-usage' as any).create({
    data: payload,
  });
}
