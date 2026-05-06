import { errors } from '@strapi/utils';
import { recomputeOrganizationUsageSnapshot } from '../../../utils/organization-usage';
import { getUserMemberships } from '../../../utils/tenant';

async function getCurrentUsageSnapshotByOrganizationDocumentId(
  organizationDocumentId: string,
  recompute = true,
) {
  const normalizedOrganizationDocumentId = String(organizationDocumentId || '').trim();

  if (!normalizedOrganizationDocumentId) {
    throw new errors.ValidationError('Organization documentId is required.');
  }

  const snapshot = recompute
    ? await recomputeOrganizationUsageSnapshot(normalizedOrganizationDocumentId)
    : await strapi.documents('api::organization-usage.organization-usage' as any).findFirst({
        filters: {
          organization: {
            documentId: normalizedOrganizationDocumentId,
          },
        },
        sort: ['periodStart:desc'],
      });

  if (!snapshot?.documentId) {
    return null;
  }

  return {
    documentId: snapshot.documentId,
    monthKey: snapshot.monthKey,
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    projectsCount: Number(snapshot.projectsCount || 0),
    usersCount: Number(snapshot.usersCount || 0),
    functionalitiesCount: Number(snapshot.functionalitiesCount || 0),
    testCasesCount: Number(snapshot.testCasesCount || 0),
    aiUsageCount: Number(snapshot.aiUsageCount || 0),
    exportUsageCount: Number(snapshot.exportUsageCount || 0),
    lastRecomputedAt: snapshot.lastRecomputedAt || null,
  };
}

export default () => ({
  async currentForOrganization(organizationDocumentId: string, recompute = true) {
    return getCurrentUsageSnapshotByOrganizationDocumentId(organizationDocumentId, recompute);
  },

  async currentForUser(userId: number, recompute = true) {
    const memberships = await getUserMemberships(strapi, userId);
    const activeOrganizationDocumentId = memberships[0]?.organization?.documentId;

    if (!activeOrganizationDocumentId) {
      throw new errors.ForbiddenError('An active organization membership is required.');
    }

    return getCurrentUsageSnapshotByOrganizationDocumentId(activeOrganizationDocumentId, recompute);
  },
});
