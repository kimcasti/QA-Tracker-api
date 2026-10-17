import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  extractConnectedDocumentId,
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
  'api::project-comment.project-comment',
  'api::delivery-unit.delivery-unit',
  'api::delivery-activity-template.delivery-activity-template',
  'api::external-participant.external-participant',
  'api::public-uat-session.public-uat-session',
]);

type TenantPolicyContext = {
  state: {
    user?: {
      id: number;
    };
  };
  params?: {
    documentId?: string;
    id?: string;
  };
  query?: Record<string, unknown>;
  request: {
    method?: string;
    body?: {
      data?: Record<string, unknown>;
    };
  };
};

type TenantPolicyDependencies = {
  getUserMembershipAccessError: typeof getUserMembershipAccessError;
  getAllowedAccessRoleCodes: typeof getAllowedAccessRoleCodes;
  getAllowedOrganizationDocumentIds: typeof getAllowedOrganizationDocumentIds;
  getOrganizationDocumentIdFromEntity: typeof getOrganizationDocumentIdFromEntity;
  getOrganizationDocumentIdFromPayload: typeof getOrganizationDocumentIdFromPayload;
  getProjectDocumentIdFromEntity: typeof getProjectDocumentIdFromEntity;
  getProjectDocumentIdFromPayload: typeof getProjectDocumentIdFromPayload;
  getUserProjectAccessScope: typeof getUserProjectAccessScope;
  getUserMemberships: typeof getUserMemberships;
};

export function createTenantAccessPolicy(
  dependencies: TenantPolicyDependencies = {
    getUserMembershipAccessError,
    getAllowedAccessRoleCodes,
    getAllowedOrganizationDocumentIds,
    getOrganizationDocumentIdFromEntity,
    getOrganizationDocumentIdFromPayload,
    getProjectDocumentIdFromEntity,
    getProjectDocumentIdFromPayload,
    getUserProjectAccessScope,
    getUserMemberships,
  },
) {
  return async (
    policyContext: TenantPolicyContext,
    config: TenantPolicyConfig,
    { strapi }: { strapi: Core.Strapi },
  ) => {
    const user = policyContext.state.user;

    if (!user) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const memberships = await dependencies.getUserMemberships(strapi, user.id);
    const allowedOrganizationDocumentIds =
      dependencies.getAllowedOrganizationDocumentIds(memberships);
    const projectAccessScope = await dependencies.getUserProjectAccessScope(
      strapi,
      user.id,
      memberships,
    );

    if (allowedOrganizationDocumentIds.length === 0) {
      throw new errors.ForbiddenError(
        await dependencies.getUserMembershipAccessError(strapi, user.id),
      );
    }

    const allowedRoles = config.allowedRoles ?? [];
    const roleOrganizationDocumentIds = memberships
      .filter(membership => allowedRoles.length === 0 ||
        allowedRoles.includes(membership.organizationRole?.code ?? ''))
      .map(membership => membership.organization?.documentId)
      .filter((id): id is string => Boolean(id));

    if (roleOrganizationDocumentIds.length === 0) {
      throw new errors.ForbiddenError('Your organization role cannot perform this action.');
    }

    const bodyData = policyContext.request.body?.data ?? {};
    const entityDocumentId = policyContext.params?.documentId ?? policyContext.params?.id;
    const isProjectScoped = PROJECT_SCOPED_CONTENT_TYPES.has(config.contentTypeUid);
    const restrictedOrganizations = roleOrganizationDocumentIds.filter(id =>
      projectAccessScope.restrictedOrganizationDocumentIds.includes(id) &&
      !projectAccessScope.unrestrictedOrganizationDocumentIds.includes(id));
    const unrestrictedOrganizations = roleOrganizationDocumentIds.filter(id =>
      !restrictedOrganizations.includes(id));
    const isExternalParticipant = config.contentTypeUid === 'api::external-participant.external-participant';
    const projectFilter = config.contentTypeUid === 'api::project.project'
      ? { documentId: { $in: projectAccessScope.allowedProjectDocumentIds } }
      : isExternalParticipant
        ? { $or: [
            { sourceProject: { documentId: { $in: projectAccessScope.allowedProjectDocumentIds } } },
            { sourceProject: { id: { $null: true } } },
          ] }
        : { project: { documentId: { $in: projectAccessScope.allowedProjectDocumentIds } } };

    if (!entityDocumentId && (policyContext.request.method || '').toUpperCase() === 'GET') {
      const currentQuery = policyContext.query ?? {};
      const scopeFilter = {
        organization: { documentId: { $in: roleOrganizationDocumentIds } },
        ...(isProjectScoped && restrictedOrganizations.length > 0
          ? unrestrictedOrganizations.length > 0
            ? { $or: [
                { organization: { documentId: { $in: unrestrictedOrganizations } } },
                { organization: { documentId: { $in: restrictedOrganizations } }, ...projectFilter },
              ] }
            : projectFilter
          : {}),
      };
      const currentFilters = currentQuery.filters as Record<string, unknown> | undefined;
      // Preserve user predicates, including logical OR, while always intersecting tenant scope.
      const overlaps = currentFilters && Object.keys(scopeFilter).some(key => key in currentFilters);
      policyContext.query = {
        ...currentQuery,
        filters: overlaps ? { $and: [currentFilters, scopeFilter] } : { ...currentFilters, ...scopeFilter },
      };
      return true;
    }

    const authorize = (organizationId: string, projectId: string | null) => {
      if (!allowedOrganizationDocumentIds.includes(organizationId)) {
        throw new errors.ForbiddenError('Cross-organization access is not allowed.');
      }
      if (!roleOrganizationDocumentIds.includes(organizationId)) {
        throw new errors.ForbiddenError('Your organization role cannot perform this action.');
      }
      if (isProjectScoped && restrictedOrganizations.includes(organizationId) &&
          !(isExternalParticipant && !projectId) &&
          (!projectId || !projectAccessScope.allowedProjectDocumentIds.includes(projectId))) {
        throw new errors.ForbiddenError('Your role is not assigned to this project.');
      }
    };

    // Persisted origin is authoritative. Never let a destination short-circuit this check.
    // Collection POSTs for results/executions have a parent rather than a route ID.
    const parentConfig = !entityDocumentId && (policyContext.request.method || '').toUpperCase() === 'POST'
      ? config.contentTypeUid === 'api::test-run-result.test-run-result'
        ? { key: 'testRun', uid: 'api::test-run.test-run' }
        : config.contentTypeUid === 'api::test-cycle-execution.test-cycle-execution'
          ? { key: 'testCycle', uid: 'api::test-cycle.test-cycle' } : null
      : null;
    const hasParent = Boolean(parentConfig && Object.prototype.hasOwnProperty.call(bodyData, parentConfig.key));
    const parentDocumentId = hasParent ? extractConnectedDocumentId(bodyData[parentConfig!.key]) : null;
    if (hasParent && !parentDocumentId) throw new errors.ValidationError('Invalid parent relation.');
    const sourceDocumentId = entityDocumentId ?? parentDocumentId;
    const sourceContentTypeUid = parentDocumentId ? parentConfig!.uid : config.contentTypeUid;
    let sourceOrganizationId: string | null = null;
    let sourceProjectId: string | null = null;
    if (sourceDocumentId) {
      sourceOrganizationId = await dependencies.getOrganizationDocumentIdFromEntity(
        strapi, sourceContentTypeUid, sourceDocumentId);
      if (!sourceOrganizationId) throw new errors.NotFoundError('Tenant resource not found.');
      sourceProjectId = await dependencies.getProjectDocumentIdFromEntity(
        strapi, sourceContentTypeUid, sourceDocumentId);
      authorize(sourceOrganizationId, sourceProjectId);
      if (parentDocumentId) {
        if (!sourceProjectId) throw new errors.ValidationError('Parent project is required.');
        // Bind omitted scope to the authorized parent, never to membership order.
        if (!Object.prototype.hasOwnProperty.call(bodyData, 'organization')) bodyData.organization = sourceOrganizationId;
        if (!Object.prototype.hasOwnProperty.call(bodyData, 'project')) bodyData.project = sourceProjectId;
      }
    }

    const payloadOrganizationId = await dependencies.getOrganizationDocumentIdFromPayload(
      strapi, config.contentTypeUid, bodyData);
    const payloadProjectId = await dependencies.getProjectDocumentIdFromPayload(
      strapi, config.contentTypeUid, bodyData);
    if (parentDocumentId && payloadProjectId !== sourceProjectId) {
      throw new errors.ValidationError('Project must match the persisted parent.');
    }
    if (sourceOrganizationId && payloadOrganizationId && sourceOrganizationId !== payloadOrganizationId) {
      throw new errors.ForbiddenError('Organization reassignment is not allowed.');
    }
    let destinationOrganizationId = payloadOrganizationId ?? sourceOrganizationId;
    if (!entityDocumentId && !destinationOrganizationId &&
        (policyContext.request.method || '').toUpperCase() === 'POST') {
      destinationOrganizationId = roleOrganizationDocumentIds[0];
      // Keep implicit workspace creation compatible, but bind the controller's fallback
      // to a tenant where this action is authorized (not the first arbitrary membership).
      policyContext.request.body ??= {};
      policyContext.request.body.data ??= {};
      policyContext.request.body.data.organization = destinationOrganizationId;
    }
    if (destinationOrganizationId) {
      authorize(destinationOrganizationId, payloadProjectId ?? sourceProjectId);
    }

    return true;
  };
}

export default createTenantAccessPolicy();
