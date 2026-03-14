import type { Core } from '@strapi/strapi';
import { ensureUserWorkspace } from './bootstrap';

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

export async function getUserMemberships(strapi: Core.Strapi, userId: number) {
  const memberships = (await strapi
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

  if (memberships.length > 0) {
    return memberships;
  }

  await ensureUserWorkspace(strapi, userId);

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
