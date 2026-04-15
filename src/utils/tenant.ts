import type { Core } from '@strapi/strapi';
import { ensureUserWorkspace, linkMembershipForRole } from './bootstrap';

type MembershipRecord = {
  documentId: string;
  isActive: boolean;
  organization?: {
    documentId: string;
    name: string;
    slug: string;
  };
  organizationRole?: {
    documentId: string;
    code: string;
    name: string;
  };
};

async function findActiveMemberships(strapi: Core.Strapi, userId: number) {
  return (await strapi
    .documents('api::organization-membership.organization-membership')
    .findMany({
      filters: {
        isActive: true,
        user: { id: userId },
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

export async function getUserMemberships(strapi: Core.Strapi, userId: number) {
  const memberships = await findActiveMemberships(strapi, userId);

  if (memberships.length > 0) {
    return memberships;
  }

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
  });
  const normalizedEmail = (user?.email || '').trim().toLowerCase();

  if (normalizedEmail) {
    const pendingInvitation = await strapi.documents(
      'api::organization-invitation.organization-invitation' as any,
    ).findFirst({
      filters: {
        email: normalizedEmail,
        status: 'pending',
      },
      populate: {
        organization: true,
        organizationRole: true,
      },
      sort: ['invitedAt:desc'],
    });

    if (pendingInvitation?.organization?.documentId && pendingInvitation.organizationRole?.code) {
      await linkMembershipForRole(
        strapi,
        pendingInvitation.organization.documentId,
        userId,
        pendingInvitation.organizationRole.code,
      );

      await strapi.documents('api::organization-invitation.organization-invitation' as any).update({
        documentId: pendingInvitation.documentId,
        data: {
          status: 'accepted',
        },
      });
    }
  }

  const invitedMemberships = await findActiveMemberships(strapi, userId);

  if (invitedMemberships.length > 0) {
    return invitedMemberships;
  }

  if (await hasMembershipHistory(strapi, userId)) {
    return [];
  }

  await ensureUserWorkspace(strapi, userId);

  return findActiveMemberships(strapi, userId);
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

function extractConnectedDocumentId(rawValue: unknown): string | null {
  if (!rawValue) return null;
  if (typeof rawValue === 'string') return rawValue;

  if (typeof rawValue === 'object') {
    const value = rawValue as {
      documentId?: string;
      connect?: Array<{ documentId?: string }>;
    };

    if (value.documentId) return value.documentId;
    if (Array.isArray(value.connect) && value.connect[0]?.documentId) {
      return value.connect[0].documentId;
    }
  }

  return null;
}

export async function getOrganizationDocumentIdFromPayload(
  strapi: Core.Strapi,
  contentTypeUid: string,
  data: Record<string, unknown>
) {
  const directOrganization = extractConnectedDocumentId(data.organization);
  if (directOrganization) return directOrganization;

  const projectDocumentId = extractConnectedDocumentId(data.project);
  if (!projectDocumentId || contentTypeUid === 'api::project.project') {
    return null;
  }

  const project = await strapi.documents('api::project.project').findOne({
    documentId: projectDocumentId,
    populate: {
      organization: true,
    },
  });

  return project?.organization?.documentId ?? null;
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
