import { errors } from '@strapi/utils';
import { ADMIN_ROLES, OWNER_ROLES } from '../../../utils/access';
import {
  buildInvitationAcceptanceUrl,
  getInvitationEmailHealth,
  isInvitationEmailEnabled,
  sendOrganizationInvitationEmail,
} from '../../../utils/mail';
import { getUserMemberships } from '../../../utils/tenant';

const TEAM_ROLE_CODES = ['owner', 'qa-lead', 'qa-engineer', 'viewer'] as const;
const PENDING_INVITATION_STATUSES = ['pending', 'expired', 'cancelled'] as const;

type TeamRoleCode = (typeof TEAM_ROLE_CODES)[number];

type TeamContext = {
  organizationDocumentId: string;
  organizationName: string;
  membershipDocumentId: string;
  currentRoleCode: string;
  canManage: boolean;
};

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function roleOrderIndex(code?: string) {
  const index = TEAM_ROLE_CODES.indexOf((code || '') as TeamRoleCode);
  return index === -1 ? TEAM_ROLE_CODES.length : index;
}

async function getOrganizationDbId(documentId: string) {
  const organization = await strapi.db.query('api::organization.organization').findOne({
    where: { documentId },
  });

  return organization?.id || null;
}

async function getRoleDbRecord(roleDocumentId: string, organizationDocumentId: string) {
  const role = await strapi.documents('api::organization-role.organization-role').findFirst({
    filters: {
      documentId: roleDocumentId,
      organization: { documentId: organizationDocumentId },
    },
  });

  if (!role?.documentId) {
    return null;
  }

  return strapi.db.query('api::organization-role.organization-role').findOne({
    where: {
      documentId: role.documentId,
    },
  });
}

async function getActiveTeamContext(userId: number): Promise<TeamContext> {
  const memberships = await getUserMemberships(strapi, userId);
  const membership = memberships[0];

  if (!membership?.organization?.documentId) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  return {
    organizationDocumentId: membership.organization.documentId,
    organizationName: membership.organization.name || 'Workspace',
    membershipDocumentId: membership.documentId,
    currentRoleCode: membership.organizationRole?.code || '',
    canManage: ADMIN_ROLES.includes((membership.organizationRole?.code || '') as any),
  };
}

async function getAvailableRoles(organizationDocumentId: string) {
  const roles = await strapi.documents('api::organization-role.organization-role').findMany({
    filters: {
      organization: { documentId: organizationDocumentId },
      code: { $in: [...TEAM_ROLE_CODES] },
    },
    populate: {
      organization: true,
    },
  });

  return roles
    .sort((left, right) => roleOrderIndex(left.code) - roleOrderIndex(right.code))
    .map(role => ({
      documentId: role.documentId,
      code: role.code,
      name: role.name,
    }));
}

async function getMembers(organizationDocumentId: string, currentUserId: number) {
  const memberships = await strapi.documents('api::organization-membership.organization-membership').findMany({
    filters: {
      organization: {
        documentId: organizationDocumentId,
      },
    },
    populate: {
      user: true,
      organizationRole: true,
    },
  });

  return memberships
    .map(membership => ({
      documentId: membership.documentId,
      name:
        membership.user?.username ||
        membership.user?.email ||
        `Usuario ${membership.user?.id || membership.documentId}`,
      email: membership.user?.email || '',
      role: membership.organizationRole
        ? {
            documentId: membership.organizationRole.documentId,
            code: membership.organizationRole.code,
            name: membership.organizationRole.name,
          }
        : null,
      status: membership.isActive ? 'active' : 'inactive',
      isCurrentUser: membership.user?.id === currentUserId,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function getInvitations(organizationDocumentId: string) {
  const invitations = await strapi.documents(
    'api::organization-invitation.organization-invitation' as any,
  ).findMany({
    filters: {
      organization: {
        documentId: organizationDocumentId,
      },
      status: {
        $in: [...PENDING_INVITATION_STATUSES],
      },
    },
    populate: {
      organization: true,
      organizationRole: true,
      invitedBy: true,
    },
    sort: ['invitedAt:desc'],
  });

  return invitations.map(invitation => ({
    documentId: invitation.documentId,
    email: invitation.email,
    acceptUrl: buildInvitationAcceptanceUrl(invitation.documentId),
    organizationId: invitation.organization?.documentId || organizationDocumentId,
    role: invitation.organizationRole
      ? {
          documentId: invitation.organizationRole.documentId,
          code: invitation.organizationRole.code,
          name: invitation.organizationRole.name,
        }
      : null,
    invitedBy: invitation.invitedBy
      ? {
          id: invitation.invitedBy.id,
          username: invitation.invitedBy.username,
          email: invitation.invitedBy.email,
        }
      : null,
    invitedAt: invitation.invitedAt,
    status: invitation.status,
  }));
}

async function buildTeamPayload(userId: number) {
  const teamContext = await getActiveTeamContext(userId);

  return {
    organization: {
      documentId: teamContext.organizationDocumentId,
      name: teamContext.organizationName,
    },
    currentMembership: {
      documentId: teamContext.membershipDocumentId,
      roleCode: teamContext.currentRoleCode,
    },
    canManage: teamContext.canManage,
    availableRoles: await getAvailableRoles(teamContext.organizationDocumentId),
    members: await getMembers(teamContext.organizationDocumentId, userId),
    invitations: await getInvitations(teamContext.organizationDocumentId),
    invitationEmailHealth: getInvitationEmailHealth(),
  };
}

async function ensureManageAccess(userId: number) {
  const teamContext = await getActiveTeamContext(userId);

  if (!teamContext.canManage) {
    throw new errors.ForbiddenError('Only Owner or QA Lead can manage organization access.');
  }

  return teamContext;
}

async function ensureOwnerAccess(userId: number) {
  const teamContext = await getActiveTeamContext(userId);

  if (!OWNER_ROLES.includes(teamContext.currentRoleCode as any)) {
    throw new errors.ForbiddenError('Only Owner can invite, change roles or deactivate access.');
  }

  return teamContext;
}

async function sendInvitationEmail(input: {
  invitationDocumentId: string;
  recipientEmail: string;
  organizationName: string;
  roleName: string;
  workspaceName?: string;
  workspaceLogoUrl?: string;
  inviterName?: string;
  inviterEmail?: string;
  invitationStatus: 'new' | 'resent';
}) {
  await sendOrganizationInvitationEmail({
    invitationDocumentId: input.invitationDocumentId,
    recipientEmail: input.recipientEmail,
    organizationName: input.organizationName,
    roleName: input.roleName,
    workspaceName: input.workspaceName,
    workspaceLogoUrl: input.workspaceLogoUrl,
    inviterName: input.inviterName,
    inviterEmail: input.inviterEmail,
    invitationStatus: input.invitationStatus,
  });
}

function getPublicApiUrl() {
  return String(process.env.PUBLIC_API_URL || '').trim().replace(/\/$/, '');
}

async function resolveWorkspaceBranding(
  organizationDocumentId: string,
  workspaceProjectDocumentId?: string,
) {
  if (!workspaceProjectDocumentId) {
    return {
      workspaceProjectDocumentId: undefined,
      workspaceName: undefined,
      workspaceLogoUrl: undefined,
    };
  }

  const workspaceProject = await strapi.documents('api::project.project').findOne({
    documentId: workspaceProjectDocumentId,
    populate: {
      organization: true,
    },
  });

  if (!workspaceProject || workspaceProject.organization?.documentId !== organizationDocumentId) {
    return {
      workspaceProjectDocumentId: undefined,
      workspaceName: undefined,
      workspaceLogoUrl: undefined,
    };
  }

  const publicApiUrl = getPublicApiUrl();

  return {
    workspaceProjectDocumentId: workspaceProject.documentId,
    workspaceName: workspaceProject.name || undefined,
    workspaceLogoUrl:
      publicApiUrl && workspaceProject.logoDataUrl
        ? `${publicApiUrl}/api/projects/${workspaceProject.documentId}/logo`
        : undefined,
  };
}

export default {
  async publicInvitation(ctx) {
    const invitationDocumentId = String(ctx.params.documentId || '').trim();

    if (!invitationDocumentId) {
      throw new errors.ValidationError('Invitation is required.');
    }

    const invitation = await strapi.documents(
      'api::organization-invitation.organization-invitation' as any,
    ).findOne({
      documentId: invitationDocumentId,
      populate: {
        organization: true,
        organizationRole: true,
      },
    });

    if (!invitation?.documentId || !invitation.organization?.documentId) {
      throw new errors.NotFoundError('Invitation not found.');
    }

    ctx.body = {
      data: {
        documentId: invitation.documentId,
        email: invitation.email,
        organization: {
          documentId: invitation.organization.documentId,
          name: invitation.organization.name,
        },
        role: invitation.organizationRole
          ? {
              documentId: invitation.organizationRole.documentId,
              code: invitation.organizationRole.code,
              name: invitation.organizationRole.name,
            }
          : null,
        status: invitation.status,
        invitedAt: invitation.invitedAt,
      },
    };
  },

  async current(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    ctx.body = await buildTeamPayload(userId);
  },

  async invite(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const teamContext = await ensureOwnerAccess(userId);
    const payload = ctx.request.body?.data || {};
    const email = normalizeEmail(payload.email);
    const roleDocumentId = String(payload.roleDocumentId || '').trim();
    const workspaceProjectDocumentId = String(payload.workspaceProjectDocumentId || '').trim();

    if (!email) {
      throw new errors.ValidationError('Email is required.');
    }

    if (!roleDocumentId) {
      throw new errors.ValidationError('Role is required.');
    }

    const roleRecord = await getRoleDbRecord(roleDocumentId, teamContext.organizationDocumentId);

    if (!roleRecord || !TEAM_ROLE_CODES.includes(roleRecord.code as TeamRoleCode)) {
      throw new errors.ValidationError('The selected role is not valid for this organization.');
    }

    const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { email },
    });

    if (existingUser) {
      const existingMembership = await strapi
        .documents('api::organization-membership.organization-membership')
        .findFirst({
          filters: {
            organization: { documentId: teamContext.organizationDocumentId },
            user: { id: existingUser.id },
            isActive: true,
          },
        });

      if (existingMembership) {
        throw new errors.ValidationError('This email already has active access in the organization.');
      }
    }

    const duplicateInvitation = await strapi.documents(
      'api::organization-invitation.organization-invitation' as any,
    ).findFirst({
      filters: {
        organization: { documentId: teamContext.organizationDocumentId },
        email,
        status: 'pending',
      },
    });

    if (duplicateInvitation) {
      throw new errors.ValidationError('There is already a pending invitation for this email.');
    }

    const organizationId = await getOrganizationDbId(teamContext.organizationDocumentId);

    if (!organizationId) {
      throw new errors.NotFoundError('Organization not found.');
    }

    const workspaceBranding = await resolveWorkspaceBranding(
      teamContext.organizationDocumentId,
      workspaceProjectDocumentId || undefined,
    );

    const created = await strapi.db
      .query('api::organization-invitation.organization-invitation' as any)
      .create({
        data: {
          email,
          invitedAt: new Date().toISOString(),
          status: 'pending',
          organization: organizationId,
          organizationRole: roleRecord.id,
          invitedBy: userId,
          workspaceProjectDocumentId: workspaceBranding.workspaceProjectDocumentId || null,
          workspaceName: workspaceBranding.workspaceName || null,
        },
      });

    const invitationDocumentId = created?.documentId;
    if (!invitationDocumentId) {
      throw new errors.ApplicationError('The invitation could not be created.');
    }

    if (isInvitationEmailEnabled()) {
      try {
        await sendInvitationEmail({
          invitationDocumentId,
          recipientEmail: email,
          organizationName: teamContext.organizationName,
          roleName: roleRecord.name,
          workspaceName: workspaceBranding.workspaceName,
          workspaceLogoUrl: workspaceBranding.workspaceLogoUrl,
          inviterEmail: ctx.state.user?.email,
          inviterName: ctx.state.user?.username,
          invitationStatus: 'new',
        });
      } catch (mailError) {
        strapi.log.error(
          `[organization-team] Failed to send invitation email to ${email}: ${
            mailError instanceof Error ? mailError.message : String(mailError)
          }`,
        );
      }
    }

    ctx.body = await buildTeamPayload(userId);
  },

  async updateMemberRole(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const teamContext = await ensureOwnerAccess(userId);
    const membershipDocumentId = String(ctx.params.documentId || '').trim();
    const roleDocumentId = String(ctx.request.body?.data?.roleDocumentId || '').trim();

    if (!membershipDocumentId || !roleDocumentId) {
      throw new errors.ValidationError('Membership and role are required.');
    }

    const membership = await strapi
      .documents('api::organization-membership.organization-membership')
      .findOne({
        documentId: membershipDocumentId,
        populate: {
          organization: true,
          user: true,
        },
      });

    if (!membership || membership.organization?.documentId !== teamContext.organizationDocumentId) {
      throw new errors.NotFoundError('Membership not found.');
    }

    const roleRecord = await getRoleDbRecord(roleDocumentId, teamContext.organizationDocumentId);

    if (!roleRecord || !TEAM_ROLE_CODES.includes(roleRecord.code as TeamRoleCode)) {
      throw new errors.ValidationError('The selected role is not valid for this organization.');
    }

    await strapi.documents('api::organization-membership.organization-membership').update({
      documentId: membershipDocumentId,
      data: {
        organizationRole: roleDocumentId,
      },
    });

    ctx.body = await buildTeamPayload(userId);
  },

  async deactivateMember(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const teamContext = await ensureOwnerAccess(userId);
    const membershipDocumentId = String(ctx.params.documentId || '').trim();

    if (!membershipDocumentId) {
      throw new errors.ValidationError('Membership is required.');
    }

    const membership = await strapi
      .documents('api::organization-membership.organization-membership')
      .findOne({
        documentId: membershipDocumentId,
        populate: {
          organization: true,
          user: true,
        },
      });

    if (!membership || membership.organization?.documentId !== teamContext.organizationDocumentId) {
      throw new errors.NotFoundError('Membership not found.');
    }

    if (membership.user?.id === userId) {
      throw new errors.ValidationError('You cannot deactivate your own access.');
    }

    await strapi.documents('api::organization-membership.organization-membership').update({
      documentId: membershipDocumentId,
      data: {
        isActive: false,
      },
    });

    ctx.body = await buildTeamPayload(userId);
  },

  async reactivateMember(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const teamContext = await ensureManageAccess(userId);
    const membershipDocumentId = String(ctx.params.documentId || '').trim();

    if (!membershipDocumentId) {
      throw new errors.ValidationError('Membership is required.');
    }

    const membership = await strapi
      .documents('api::organization-membership.organization-membership')
      .findOne({
        documentId: membershipDocumentId,
        populate: {
          organization: true,
          user: true,
        },
      });

    if (!membership || membership.organization?.documentId !== teamContext.organizationDocumentId) {
      throw new errors.NotFoundError('Membership not found.');
    }

    await strapi.documents('api::organization-membership.organization-membership').update({
      documentId: membershipDocumentId,
      data: {
        isActive: true,
      },
    });

    ctx.body = await buildTeamPayload(userId);
  },

  async resendInvitation(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const teamContext = await ensureManageAccess(userId);
    const invitationDocumentId = String(ctx.params.documentId || '').trim();

    if (!invitationDocumentId) {
      throw new errors.ValidationError('Invitation is required.');
    }

    if (!isInvitationEmailEnabled()) {
      throw new errors.ValidationError(
        'Invitation emails are disabled. Copy and share the public link manually.',
      );
    }

    const invitation = await strapi.documents(
      'api::organization-invitation.organization-invitation' as any,
    ).findOne({
      documentId: invitationDocumentId,
      populate: {
        organization: true,
        organizationRole: true,
      },
    });

    if (!invitation || invitation.organization?.documentId !== teamContext.organizationDocumentId) {
      throw new errors.NotFoundError('Invitation not found.');
    }

    const workspaceBranding = await resolveWorkspaceBranding(
      teamContext.organizationDocumentId,
      invitation.workspaceProjectDocumentId || undefined,
    );

    try {
      await sendInvitationEmail({
        invitationDocumentId,
        recipientEmail: invitation.email,
        organizationName: invitation.organization?.name || teamContext.organizationName,
        roleName: invitation.organizationRole?.name || 'Viewer',
        workspaceName: invitation.workspaceName || workspaceBranding.workspaceName,
        workspaceLogoUrl: workspaceBranding.workspaceLogoUrl,
        inviterEmail: ctx.state.user?.email,
        inviterName: ctx.state.user?.username,
        invitationStatus: 'resent',
      });
    } catch (mailError) {
      strapi.log.error(
        `[organization-team] Failed to resend invitation email to ${invitation.email}: ${
          mailError instanceof Error ? mailError.message : String(mailError)
        }`,
      );

      throw new errors.ApplicationError(
        mailError instanceof Error ? mailError.message : 'The invitation email could not be sent.',
      );
    }

    await strapi.documents('api::organization-invitation.organization-invitation' as any).update({
      documentId: invitationDocumentId,
      data: {
        invitedAt: new Date().toISOString(),
        status: 'pending',
      },
    });

    ctx.body = await buildTeamPayload(userId);
  },

  async cancelInvitation(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const teamContext = await ensureManageAccess(userId);
    const invitationDocumentId = String(ctx.params.documentId || '').trim();

    if (!invitationDocumentId) {
      throw new errors.ValidationError('Invitation is required.');
    }

    const invitation = await strapi.documents(
      'api::organization-invitation.organization-invitation' as any,
    ).findOne({
      documentId: invitationDocumentId,
      populate: {
        organization: true,
      },
    });

    if (!invitation || invitation.organization?.documentId !== teamContext.organizationDocumentId) {
      throw new errors.NotFoundError('Invitation not found.');
    }

    await strapi.documents('api::organization-invitation.organization-invitation' as any).update({
      documentId: invitationDocumentId,
      data: {
        status: 'cancelled',
      },
    });

    ctx.body = await buildTeamPayload(userId);
  },
};
