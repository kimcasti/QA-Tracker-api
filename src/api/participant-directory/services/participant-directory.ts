import { errors } from '@strapi/utils';

type DirectoryMember = {
  id: string;
  username: string;
  realName: string;
  displayName: string;
  fullName: string;
  email?: string;
  title?: string;
  avatarUrl?: string;
  isExternal?: boolean;
};

function normalizeComparableValue(value?: string | null) {
  return (value || '').trim().toLowerCase();
}

function buildDisplayName(user: { username?: string | null; email?: string | null }) {
  const username = (user.username || '').trim();
  const email = (user.email || '').trim();
  return username || email || 'Usuario';
}

export default () => ({
  async members(userId: number): Promise<DirectoryMember[]> {
    if (!userId) {
      throw new errors.ForbiddenError('User session is required.');
    }

    const activeMemberships = await strapi
      .documents('api::organization-membership.organization-membership')
      .findMany({
        filters: {
          user: { id: userId },
          isActive: true,
          organization: {
            status: 'active',
          },
        },
        populate: {
          organization: {
            fields: ['documentId'],
          },
        },
      });

    const organizationDocumentIds = activeMemberships
      .map(membership => membership.organization?.documentId)
      .filter(Boolean);

    if (!organizationDocumentIds.length) {
      return [];
    }

    const memberships = await strapi
      .documents('api::organization-membership.organization-membership')
      .findMany({
        filters: {
          organization: {
            documentId: {
              $in: organizationDocumentIds,
            },
            status: 'active',
          },
          isActive: true,
        },
        populate: {
          user: true,
          organizationRole: {
            fields: ['name'],
          },
        },
      });

    const members = new Map<string, DirectoryMember>();

    memberships.forEach(membership => {
      const user = membership.user as
        | {
            id?: number;
            username?: string | null;
            email?: string | null;
          }
        | undefined;

      const userKey = user?.id ? `${user.id}` : normalizeComparableValue(user?.email || user?.username);
      if (!userKey) return;

      const displayName = buildDisplayName({
        username: user?.username,
        email: user?.email,
      });

      const existing = members.get(userKey);
      const roleName = membership.organizationRole?.name?.trim() || undefined;

      if (!existing) {
        members.set(userKey, {
          id: userKey,
          username: (user?.username || '').trim(),
          realName: displayName,
          displayName,
          fullName: displayName,
          email: (user?.email || '').trim() || undefined,
          title: roleName,
          avatarUrl: undefined,
        });
        return;
      }

      if (!existing.title && roleName) {
        existing.title = roleName;
      }
    });

    const externalParticipants = await strapi
      .documents('api::external-participant.external-participant')
      .findMany({
        filters: {
          organization: {
            documentId: {
              $in: organizationDocumentIds,
            },
          },
        },
        populate: {
          organization: {
            fields: ['documentId'],
          },
          sourceProject: {
            fields: ['documentId'],
          },
        },
        sort: ['name:asc'],
      });

    externalParticipants.forEach(participant => {
      const participantKey = `external:${participant.documentId}`;
      const name = (participant.name || '').trim();
      if (!name || members.has(participantKey)) return;

      members.set(participantKey, {
        id: participantKey,
        username: '',
        realName: name,
        displayName: name,
        fullName: name,
        email: (participant.email || '').trim() || undefined,
        title: (participant.role || '').trim() || undefined,
        avatarUrl: undefined,
        isExternal: true,
      });
    });

    return Array.from(members.values()).sort((left, right) =>
      left.fullName.localeCompare(right.fullName),
    );
  },
});
