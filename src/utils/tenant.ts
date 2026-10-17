import { errors } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import { ensureUserWorkspace } from './bootstrap';

export const ACTIVE_MEMBERSHIP_REQUIRED_ERROR = 'An active organization membership is required.';
export const INACTIVE_MEMBERSHIP_ERROR = 'Your organization membership is inactive.';
export const INACTIVE_ORGANIZATION_ERROR = 'Your organization is inactive.';
export const PROJECT_ASSIGNED_ROLE_CODES = ['manager', 'viewer'] as const;

type ProjectAssignedRoleCode = (typeof PROJECT_ASSIGNED_ROLE_CODES)[number];

type MembershipRecord = {
  documentId: string;
  isActive: boolean;
  organization?: {
    documentId: string;
    name: string;
    slug: string;
    plan?: 'starter' | 'growth' | 'enterprise';
    status?: 'active' | 'inactive';
  };
  organizationRole?: {
    documentId: string;
    code: string;
    name: string;
  };
};

type UserProjectAccessScope = {
  allowedOrganizationDocumentIds: string[];
  unrestrictedOrganizationDocumentIds: string[];
  restrictedOrganizationDocumentIds: string[];
  allowedProjectDocumentIds: string[];
  hasProjectRestrictions: boolean;
};

async function findActiveMemberships(strapi: Core.Strapi, userId: number) {
  return (await strapi
    .documents('api::organization-membership.organization-membership')
    .findMany({
      filters: {
        isActive: true,
        user: { id: userId },
        organization: {
          status: 'active',
        },
      },
      populate: {
        organization: true,
        organizationRole: true,
      },
    })) as unknown as MembershipRecord[];
}

async function hasMembershipHistory(strapi: Core.Strapi, userId: number) {
  const membership = await strapi
    .documents('api::organization-membership.organization-membership')
    .findFirst({
      filters: {
        user: { id: userId },
      },
    });

  return Boolean(membership?.documentId);
}

async function hasMembershipInInactiveOrganization(strapi: Core.Strapi, userId: number) {
  const membership = await strapi
    .documents('api::organization-membership.organization-membership')
    .findFirst({
      filters: {
        user: { id: userId },
        isActive: true,
        organization: {
          status: 'inactive',
        },
      },
      fields: ['documentId'],
    });

  return Boolean(membership?.documentId);
}

async function hasInactiveMembership(strapi: Core.Strapi, userId: number) {
  const membership = await strapi
    .documents('api::organization-membership.organization-membership')
    .findFirst({
      filters: {
        user: { id: userId },
        isActive: false,
      },
      fields: ['documentId'],
    });

  return Boolean(membership?.documentId);
}

export async function getUserMemberships(strapi: Core.Strapi, userId: number) {
  const memberships = await findActiveMemberships(strapi, userId);

  if (memberships.length > 0) {
    return memberships;
  }

  // Reading memberships must never accept invitations or grant access based on
  // a declared email. Membership linking belongs to the proof-verified flow.

  if (await hasMembershipHistory(strapi, userId)) {
    return [];
  }

  await ensureUserWorkspace(strapi, userId);

  return findActiveMemberships(strapi, userId);
}

export async function getUserMembershipAccessError(strapi: Core.Strapi, userId: number) {
  const memberships = await findActiveMemberships(strapi, userId);

  if (memberships.length > 0) {
    return null;
  }

  if (await hasMembershipInInactiveOrganization(strapi, userId)) {
    return INACTIVE_ORGANIZATION_ERROR;
  }

  if (await hasInactiveMembership(strapi, userId)) {
    return INACTIVE_MEMBERSHIP_ERROR;
  }

  if (await hasMembershipHistory(strapi, userId)) {
    return INACTIVE_MEMBERSHIP_ERROR;
  }

  return ACTIVE_MEMBERSHIP_REQUIRED_ERROR;
}

export function getAllowedOrganizationDocumentIds(memberships: MembershipRecord[]) {
  return memberships
    .map((membership) => membership.organization?.documentId)
    .filter((value): value is string => Boolean(value));
}

export function getAllowedAccessRoleCodes(memberships: MembershipRecord[]) {
  return memberships
    .map((membership) => membership.organizationRole?.code)
    .filter((value): value is string => Boolean(value));
}

export function isProjectAssignmentRoleCode(roleCode?: string): roleCode is ProjectAssignedRoleCode {
  return PROJECT_ASSIGNED_ROLE_CODES.includes((roleCode || '') as ProjectAssignedRoleCode);
}

async function getAcceptedProjectAssignments(
  strapi: Core.Strapi,
  email: string,
  organizationDocumentIds: string[]
) {
  if (!email || organizationDocumentIds.length === 0) {
    return [];
  }

  const invitations = await strapi.documents(
    'api::organization-invitation.organization-invitation' as any,
  ).findMany({
    filters: {
      email,
      status: 'accepted',
      organization: {
        documentId: {
          $in: organizationDocumentIds,
        },
      },
    },
    fields: ['workspaceProjectDocumentId', 'workspaceProjectDocumentIds'],
    sort: ['invitedAt:desc'],
  });

  const projectIds = invitations.flatMap(invitation => {
    const multiProjectIds = Array.isArray(invitation.workspaceProjectDocumentIds)
      ? invitation.workspaceProjectDocumentIds
      : [];

    const normalizedMulti = multiProjectIds
      .map(projectId => String(projectId || '').trim())
      .filter(Boolean);

    if (normalizedMulti.length > 0) {
      return normalizedMulti;
    }

    const legacyProjectId = String(invitation.workspaceProjectDocumentId || '').trim();
    return legacyProjectId ? [legacyProjectId] : [];
  });

  return Array.from(new Set(projectIds));
}

export async function getUserProjectAccessScope(
  strapi: Core.Strapi,
  userId: number,
  memberships?: MembershipRecord[]
): Promise<UserProjectAccessScope> {
  const resolvedMemberships = memberships ?? (await getUserMemberships(strapi, userId));
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(resolvedMemberships);
  const unrestrictedOrganizationDocumentIds = resolvedMemberships
    .filter((membership) => !isProjectAssignmentRoleCode(membership.organizationRole?.code))
    .map((membership) => membership.organization?.documentId)
    .filter((value): value is string => Boolean(value));
  const restrictedOrganizationDocumentIds = resolvedMemberships
    .filter((membership) => isProjectAssignmentRoleCode(membership.organizationRole?.code))
    .map((membership) => membership.organization?.documentId)
    .filter((value): value is string => Boolean(value));

  const hasProjectRestrictions = restrictedOrganizationDocumentIds.length > 0;

  if (!hasProjectRestrictions) {
    return {
      allowedOrganizationDocumentIds,
      unrestrictedOrganizationDocumentIds,
      restrictedOrganizationDocumentIds,
      allowedProjectDocumentIds: [],
      hasProjectRestrictions: false,
    };
  }

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['email'],
  });
  const normalizedEmail = (user?.email || '').trim().toLowerCase();
  const allowedProjectDocumentIds = await getAcceptedProjectAssignments(
    strapi,
    normalizedEmail,
    restrictedOrganizationDocumentIds,
  );

  return {
    allowedOrganizationDocumentIds,
    unrestrictedOrganizationDocumentIds,
    restrictedOrganizationDocumentIds,
    allowedProjectDocumentIds,
    hasProjectRestrictions: true,
  };
}

export function extractConnectedDocumentId(rawValue: unknown): string | null {
  if (typeof rawValue === 'string' && rawValue.trim()) return rawValue;
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return null;
  const value = rawValue as Record<string, unknown>;
  const operations = ['documentId', 'connect', 'set'].filter(key => key in value);
  if (operations.length !== 1 || ('disconnect' in value)) return null;
  if (operations[0] === 'documentId') {
    return typeof value.documentId === 'string' && value.documentId.trim() ? value.documentId : null;
  }
  const relations = value[operations[0]];
  if (!Array.isArray(relations) || relations.length !== 1) return null;
  return extractConnectedDocumentId(relations[0]);
}

function payloadRelation(data: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(data, key)) return null;
  const documentId = extractConnectedDocumentId(data[key]);
  if (!documentId) throw new errors.ValidationError(`Invalid ${key} relation.`);
  return documentId;
}

export async function getOrganizationDocumentIdFromPayload(
  strapi: Core.Strapi,
  contentTypeUid: string,
  data: Record<string, unknown>
) {
  const directOrganization = payloadRelation(data, 'organization');
  const projectRelation = contentTypeUid === 'api::external-participant.external-participant'
    ? 'sourceProject' : 'project';
  const projectDocumentId = payloadRelation(data, projectRelation);
  if (!projectDocumentId || contentTypeUid === 'api::project.project') return directOrganization;

  const project = await strapi.documents('api::project.project').findOne({
    documentId: projectDocumentId,
    populate: { organization: true },
  });
  if (!project?.organization?.documentId) throw new errors.ValidationError('Project not found or has no organization.');
  if (directOrganization && directOrganization !== project.organization.documentId) {
    throw new errors.ValidationError('Project and organization do not match.');
  }
  return project.organization.documentId;
}

export async function getProjectDocumentIdFromPayload(
  strapi: Core.Strapi,
  contentTypeUid: string,
  data: Record<string, unknown>
) {
  if (contentTypeUid === 'api::project.project') {
    return extractConnectedDocumentId(data.documentId) ?? null;
  }

  const projectRelation = contentTypeUid === 'api::external-participant.external-participant'
    ? 'sourceProject' : 'project';
  const directProject = extractConnectedDocumentId(data[projectRelation]);
  if (directProject) return directProject;

  return null;
}

export async function getOrganizationDocumentIdFromEntity(
  strapi: Core.Strapi,
  contentTypeUid: string,
  documentId: string
) {
  const entity = await strapi.documents(contentTypeUid as any).findOne({
    documentId,
    populate: {
      organization: true,
    },
  });

  return entity?.organization?.documentId ?? null;
}

export async function getProjectDocumentIdFromEntity(
  strapi: Core.Strapi,
  contentTypeUid: string,
  documentId: string
) {
  if (contentTypeUid === 'api::project.project') {
    return documentId;
  }

  const projectRelation = contentTypeUid === 'api::external-participant.external-participant'
    ? 'sourceProject' : 'project';
  const entity = await strapi.documents(contentTypeUid as any).findOne({
    documentId,
    populate: {
      [projectRelation]: true,
    },
  });

  return entity?.[projectRelation]?.documentId ?? null;
}
