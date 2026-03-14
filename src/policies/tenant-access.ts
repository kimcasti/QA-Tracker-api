import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedAccessRoleCodes,
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromEntity,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../utils/tenant';

type TenantPolicyConfig = {
  allowedRoles?: string[];
  contentTypeUid: string;
};

type TenantPolicyContext = {
  state: {
    user?: {
      id: number;
    };
  };
  params: {
    documentId?: string;
  };
  query?: Record<string, unknown>;
  request: {
    method?: string;
    body?: {
      data?: Record<string, unknown>;
    };
  };
};

function ensureRoleAccess(allowedRoles: string[], membershipRoleCodes: string[]) {
  return allowedRoles.some((roleCode) => membershipRoleCodes.includes(roleCode));
}

export default async (
  policyContext: TenantPolicyContext,
  config: TenantPolicyConfig,
  { strapi }: { strapi: Core.Strapi }
) => {
  const user = policyContext.state.user;

  if (!user) {
    throw new errors.UnauthorizedError('Authentication is required.');
  }

  const memberships = await getUserMemberships(strapi, user.id);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);
  const membershipRoleCodes = getAllowedAccessRoleCodes(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const allowedRoles = config.allowedRoles ?? [];

  if (allowedRoles.length > 0 && !ensureRoleAccess(allowedRoles, membershipRoleCodes)) {
    throw new errors.ForbiddenError('Your organization role cannot perform this action.');
  }

  const bodyData = policyContext.request.body?.data ?? {};
  const entityDocumentId = policyContext.params.documentId;

  if (!entityDocumentId && !bodyData.organization && !bodyData.project) {
    const requestMethod = (policyContext.request.method || '').toUpperCase();

    if (requestMethod === 'GET') {
      const currentQuery = policyContext.query ?? {};

      policyContext.query = {
        ...currentQuery,
        filters: {
          ...(currentQuery.filters as Record<string, unknown> | undefined),
          organization: {
            documentId: {
              $in: allowedOrganizationDocumentIds,
            },
          },
        },
      };
    }

    return true;
  }

  const requestedOrganizationDocumentId =
    (await getOrganizationDocumentIdFromPayload(strapi, config.contentTypeUid, bodyData)) ??
    (entityDocumentId
      ? await getOrganizationDocumentIdFromEntity(strapi, config.contentTypeUid, entityDocumentId)
      : null);

  if (
    requestedOrganizationDocumentId &&
    !allowedOrganizationDocumentIds.includes(requestedOrganizationDocumentId)
  ) {
    throw new errors.ForbiddenError('Cross-organization access is not allowed.');
  }

  return true;
};
