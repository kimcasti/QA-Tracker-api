import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getUserMembershipAccessError,
  getAllowedAccessRoleCodes,
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromEntity,
  getOrganizationDocumentIdFromPayload,
  getProjectDocumentIdFromEntity,
  getProjectDocumentIdFromPayload,
  getUserProjectAccessScope,
  getUserMemberships,
} from '../utils/tenant';

type TenantPolicyConfig = {
  allowedRoles?: string[];
  contentTypeUid: string;
};

const PROJECT_SCOPED_CONTENT_TYPES = new Set([
  'api::project.project',
  'api::project-proposal.project-proposal',
  'api::project-story-map.project-story-map',
  'api::project-module.project-module',
  'api::project-persona-role.project-persona-role',
  'api::sprint.sprint',
  'api::functionality.functionality',
  'api::test-case.test-case',
  'api::test-case-template.test-case-template',
  'api::test-run.test-run',
  'api::test-run-result.test-run-result',
  'api::test-cycle.test-cycle',
  'api::test-cycle-execution.test-cycle-execution',
  'api::test-plan.test-plan',
  'api::bug.bug',
  'api::meeting-note.meeting-note',
  'api::delivery-unit.delivery-unit',
  'api::delivery-activity-template.delivery-activity-template',
  'api::external-participant.external-participant',
]);

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
  const projectAccessScope = await getUserProjectAccessScope(strapi, user.id, memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError(await getUserMembershipAccessError(strapi, user.id));
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
          ...(projectAccessScope.hasProjectRestrictions &&
          PROJECT_SCOPED_CONTENT_TYPES.has(config.contentTypeUid)
            ? config.contentTypeUid === 'api::project.project'
              ? {
                  documentId: {
                    $in: projectAccessScope.allowedProjectDocumentIds,
                  },
                }
              : {
                  project: {
                    documentId: {
                      $in: projectAccessScope.allowedProjectDocumentIds,
                    },
                  },
                }
            : {}),
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
  const requestedProjectDocumentId =
    (await getProjectDocumentIdFromPayload(strapi, config.contentTypeUid, bodyData)) ??
    (entityDocumentId
      ? await getProjectDocumentIdFromEntity(strapi, config.contentTypeUid, entityDocumentId)
      : null);

  if (
    requestedOrganizationDocumentId &&
    !allowedOrganizationDocumentIds.includes(requestedOrganizationDocumentId)
  ) {
    throw new errors.ForbiddenError('Cross-organization access is not allowed.');
  }

  if (
    requestedProjectDocumentId &&
    projectAccessScope.hasProjectRestrictions &&
    !projectAccessScope.allowedProjectDocumentIds.includes(requestedProjectDocumentId)
  ) {
    throw new errors.ForbiddenError('Your role is not assigned to this project.');
  }

  return true;
};
