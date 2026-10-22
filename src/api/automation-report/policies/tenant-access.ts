import { errors } from '@strapi/utils';
import { READ_ROLES } from '../../../utils/access';
import { createTenantAccessPolicy } from '../../../policies/tenant-access';
import {
  getUserMembershipAccessError,
  getAllowedAccessRoleCodes,
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromEntity,
  getOrganizationDocumentIdFromPayload,
  getProjectDocumentIdFromEntity,
  getProjectDocumentIdFromPayload,
  getUserProjectAccessScope,
} from '../../../utils/tenant';

// Reuse the real tenant policy, replacing ONLY its membership reader: the shared
// getUserMemberships may bootstrap a workspace for a new user (a write on GET).
// Never call that reader here, even when no membership/history exists.
const dependencies = {
  getUserMembershipAccessError,
  getAllowedAccessRoleCodes,
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromEntity,
  getOrganizationDocumentIdFromPayload,
  getProjectDocumentIdFromEntity,
  getProjectDocumentIdFromPayload,
  getUserProjectAccessScope,
  async getUserMemberships(strapi: any, userId: number) {
    const memberships = await strapi.documents('api::organization-membership.organization-membership').findMany({
      filters: { isActive: true, user: { id: userId }, organization: { status: 'active' } },
      populate: { organization: true, organizationRole: true },
    });
    if (!memberships.length) throw new errors.ForbiddenError('An active organization membership is required.');
    return memberships as any;
  },
};

export default createTenantAccessPolicy(dependencies);

// Authorize the same persisted snapshot that scopes the subsequent jobs query.
export async function authorizeReportRunSnapshot(ctx: any, run: any, api: any) {
  const organizationId = run.project?.organization?.documentId;
  const projectId = run.project?.documentId;
  if (!organizationId || !projectId || run.documentId !== ctx.params.documentId ||
      (run.organization?.documentId && run.organization.documentId !== organizationId)) {
    throw new errors.ForbiddenError('La organización de la ejecución y su proyecto no son coherentes.');
  }
  const policy = createTenantAccessPolicy({
    ...dependencies,
    getOrganizationDocumentIdFromEntity: async () => organizationId,
    getProjectDocumentIdFromEntity: async () => projectId,
  });
  return policy(ctx, { contentTypeUid: 'api::test-run.test-run', allowedRoles: READ_ROLES }, { strapi: api });
}
