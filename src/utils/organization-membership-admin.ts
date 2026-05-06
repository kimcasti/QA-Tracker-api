import { errors } from '@strapi/utils';

export async function countActiveMembershipsForUser(userId: number) {
  const memberships = await strapi.db
    .query('api::organization-membership.organization-membership')
    .findMany({
      where: {
        user: userId,
        isActive: true,
      },
    });

  return memberships.length;
}

export async function setUserBlockedState(userId: number, blocked: boolean) {
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
  });

  if (!user?.id || Boolean(user.blocked) === blocked) {
    return;
  }

  await strapi.db.query('plugin::users-permissions.user').update({
    where: { id: userId },
    data: { blocked },
  });
}

export async function syncUserAccessState(userId: number) {
  const activeMemberships = await countActiveMembershipsForUser(userId);
  await setUserBlockedState(userId, activeMemberships === 0);
}

export function toNumericUserId(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export async function ensureOrganizationKeepsOwner(organizationDocumentId: string, membershipDocumentIdToIgnore?: string) {
  const activeMemberships = await strapi.documents('api::organization-membership.organization-membership').findMany({
    filters: {
      organization: {
        documentId: organizationDocumentId,
      },
      isActive: true,
    },
    populate: {
      organizationRole: true,
    },
  });

  const ownerCount = activeMemberships.filter((membership) => {
    if (membershipDocumentIdToIgnore && membership.documentId === membershipDocumentIdToIgnore) {
      return false;
    }

    return membership.organizationRole?.code === 'owner';
  }).length;

  if (ownerCount === 0) {
    throw new errors.ValidationError('The organization must keep at least one active owner.');
  }
}
