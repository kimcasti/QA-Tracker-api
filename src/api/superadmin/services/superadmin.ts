async function countProjectsForOrganization(organizationDocumentId: string) {
  return strapi.db.query('api::project.project').count({
    where: {
      organization: {
        documentId: organizationDocumentId,
      },
    },
  });
}

async function countMembershipsForOrganization(organizationDocumentId: string, isActive?: boolean) {
  const where: Record<string, unknown> = {
    organization: {
      documentId: organizationDocumentId,
    },
  };

  if (typeof isActive === 'boolean') {
    where.isActive = isActive;
  }

  return strapi.db.query('api::organization-membership.organization-membership').count({ where });
}

async function countPendingInvitationsForOrganization(organizationDocumentId: string) {
  return strapi.db.query('api::organization-invitation.organization-invitation').count({
    where: {
      organization: {
        documentId: organizationDocumentId,
      },
      status: 'pending',
    },
  });
}

async function getOrganizationContactNumber(organizationDocumentId: string) {
  const [ownerMembership] = await strapi
    .documents('api::organization-membership.organization-membership')
    .findMany({
      filters: {
        organization: {
          documentId: organizationDocumentId,
        },
        organizationRole: {
          code: 'owner',
        },
      },
      populate: {
        user: true,
      },
      pagination: {
        page: 1,
        pageSize: 1,
      },
    });

  if (ownerMembership?.user?.contactNumber) {
    return ownerMembership.user.contactNumber;
  }

  const [fallbackMembership] = await strapi
    .documents('api::organization-membership.organization-membership')
    .findMany({
      filters: {
        organization: {
          documentId: organizationDocumentId,
        },
      },
      populate: {
        user: true,
      },
      sort: ['createdAt:asc'],
      pagination: {
        page: 1,
        pageSize: 1,
      },
    });

  return fallbackMembership?.user?.contactNumber || null;
}

async function getAvailableRoles(organizationDocumentId: string) {
  const roles = await strapi.documents('api::organization-role.organization-role').findMany({
    filters: {
      organization: { documentId: organizationDocumentId },
    },
    fields: ['documentId', 'code', 'name'],
    sort: ['name:asc'],
  });

  return roles.map((role) => ({
    documentId: role.documentId,
    code: role.code,
    name: role.name,
  }));
}

async function getAuditLogs(organizationDocumentId: string) {
  const logs = await strapi.documents('api::superadmin-audit-log.superadmin-audit-log' as any).findMany({
    filters: {
      organization: { documentId: organizationDocumentId },
    },
    populate: {
      actor: true,
    },
    sort: ['createdAt:desc'],
    pagination: {
      page: 1,
      pageSize: 50,
    },
  });

  return logs.map((log: any) => ({
    documentId: log.documentId,
    action: log.action,
    targetType: log.targetType,
    targetDocumentId: log.targetDocumentId || null,
    targetLabel: log.targetLabel || null,
    details: log.details || null,
    createdAt: log.createdAt,
    actor: log.actor
      ? {
          id: log.actor.id,
          username: log.actor.username,
          email: log.actor.email,
        }
      : null,
  }));
}

async function getBillingRequests() {
  const requests = await strapi.documents('api::billing-request.billing-request' as any).findMany({
    populate: {
      organization: true,
      requestedBy: true,
      handledBy: true,
    },
    sort: ['requestedAt:desc', 'createdAt:desc'],
    pagination: {
      page: 1,
      pageSize: 100,
    },
  });

  return requests.map((request: any) => ({
    documentId: request.documentId,
    requestedPlan: request.requestedPlan,
    status: request.status || 'pending',
    source: request.source || null,
    requestedAt: request.requestedAt || request.createdAt || null,
    handledAt: request.handledAt || null,
    currentCount: typeof request.currentCount === 'number' ? request.currentCount : null,
    limitValue: typeof request.limitValue === 'number' ? request.limitValue : null,
    priceMonthlyUsd:
      typeof request.priceMonthlyUsd === 'number' ? request.priceMonthlyUsd : Number(request.priceMonthlyUsd || 0) || null,
    notes: request.notes || null,
    statusNotes: request.statusNotes || null,
    paymentMethod: request.paymentMethod || null,
    externalReference: request.externalReference || null,
    organization: request.organization
      ? {
          documentId: request.organization.documentId,
          name: request.organization.name,
          slug: request.organization.slug,
          plan: request.organization.plan,
          planStatus: request.organization.planStatus || 'active',
        }
      : null,
    requestedBy: request.requestedBy
      ? {
          id: request.requestedBy.id,
          username: request.requestedBy.username,
          email: request.requestedBy.email,
          contactNumber: request.requestedBy.contactNumber || null,
        }
      : null,
    handledBy: request.handledBy
      ? {
          id: request.handledBy.id,
          username: request.handledBy.username,
          email: request.handledBy.email,
          contactNumber: request.handledBy.contactNumber || null,
        }
      : null,
  }));
}

export default () => ({
  async organizations() {
    const organizations = await strapi.documents('api::organization.organization').findMany({
      fields: [
        'documentId',
        'name',
        'slug',
        'status',
        'plan',
        'planStatus',
        'planExpiresAt',
        'gracePeriodEndsAt',
        'planUpdatedAt',
        'aiUsageThisMonth',
        'aiResetAt',
        'aiLimit',
        'exportUsageThisMonth',
        'usageResetAt',
        'exportLimitMonthly',
        'billingNotes',
        'createdAt',
        'updatedAt',
      ] as any,
      sort: ['name:asc'],
    });

    const items = await Promise.all(
      organizations.map(async (organization) => {
        const organizationRecord = organization as any;
        const [memberCount, activeMemberCount, pendingInvitationCount, projectCount, contactNumber] =
          await Promise.all([
            countMembershipsForOrganization(organization.documentId),
            countMembershipsForOrganization(organization.documentId, true),
            countPendingInvitationsForOrganization(organization.documentId),
            countProjectsForOrganization(organization.documentId),
            getOrganizationContactNumber(organization.documentId),
          ]);

        return {
          documentId: organization.documentId,
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
          plan: organization.plan,
          planStatus: organizationRecord.planStatus || 'active',
          planExpiresAt: organizationRecord.planExpiresAt || null,
          gracePeriodEndsAt: organizationRecord.gracePeriodEndsAt || null,
          planUpdatedAt: organizationRecord.planUpdatedAt || null,
          aiUsageThisMonth: Number(organizationRecord.aiUsageThisMonth || 0),
          aiResetAt: organizationRecord.aiResetAt || null,
          aiLimit: typeof organizationRecord.aiLimit === 'number' ? organizationRecord.aiLimit : null,
          exportUsageThisMonth: Number(organizationRecord.exportUsageThisMonth || 0),
          usageResetAt: organizationRecord.usageResetAt || null,
          exportLimitMonthly:
            typeof organizationRecord.exportLimitMonthly === 'number'
              ? organizationRecord.exportLimitMonthly
              : null,
          contactNumber,
          billingNotes: organizationRecord.billingNotes || null,
          createdAt: organization.createdAt,
          updatedAt: organization.updatedAt,
          memberCount,
          activeMemberCount,
          pendingInvitationCount,
          projectCount,
        };
      }),
    );

    return { organizations: items };
  },

  async memberships(organizationDocumentId: string) {
    const organization = await strapi.documents('api::organization.organization').findFirst({
      filters: {
        documentId: organizationDocumentId,
      },
      fields: [
        'documentId',
        'name',
        'slug',
        'status',
        'plan',
        'planStatus',
        'planExpiresAt',
        'gracePeriodEndsAt',
        'planUpdatedAt',
        'aiUsageThisMonth',
        'aiResetAt',
        'aiLimit',
        'exportUsageThisMonth',
        'usageResetAt',
        'exportLimitMonthly',
        'billingNotes',
      ] as any,
    });

    if (!organization?.documentId) {
      return null;
    }

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
      sort: ['createdAt:asc'],
    });

    const organizationRecord = organization as any;
    return {
      organization: {
        documentId: organization.documentId,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        plan: organization.plan,
        planStatus: organizationRecord.planStatus || 'active',
        planExpiresAt: organizationRecord.planExpiresAt || null,
        gracePeriodEndsAt: organizationRecord.gracePeriodEndsAt || null,
        planUpdatedAt: organizationRecord.planUpdatedAt || null,
        aiUsageThisMonth: Number(organizationRecord.aiUsageThisMonth || 0),
        aiResetAt: organizationRecord.aiResetAt || null,
        aiLimit: typeof organizationRecord.aiLimit === 'number' ? organizationRecord.aiLimit : null,
        exportUsageThisMonth: Number(organizationRecord.exportUsageThisMonth || 0),
        usageResetAt: organizationRecord.usageResetAt || null,
        exportLimitMonthly:
          typeof organizationRecord.exportLimitMonthly === 'number'
            ? organizationRecord.exportLimitMonthly
            : null,
        billingNotes: organizationRecord.billingNotes || null,
      },
      availableRoles: await getAvailableRoles(organizationDocumentId),
      memberships: memberships.map((membership) => ({
        documentId: membership.documentId,
        isActive: Boolean(membership.isActive),
        createdAt: membership.createdAt,
        updatedAt: membership.updatedAt,
        user: membership.user
          ? {
              id: membership.user.id,
              username: membership.user.username,
              email: membership.user.email,
              blocked: Boolean(membership.user.blocked),
              isSuperAdmin: Boolean(membership.user.isSuperAdmin),
            }
          : null,
        role: membership.organizationRole
          ? {
              documentId: membership.organizationRole.documentId,
              code: membership.organizationRole.code,
              name: membership.organizationRole.name,
            }
          : null,
      })),
    };
  },

  async invitations(organizationDocumentId: string) {
    const organization = await strapi.documents('api::organization.organization').findFirst({
      filters: {
        documentId: organizationDocumentId,
      },
      fields: [
        'documentId',
        'name',
        'slug',
        'status',
        'plan',
        'planStatus',
        'planExpiresAt',
        'gracePeriodEndsAt',
        'planUpdatedAt',
        'aiUsageThisMonth',
        'aiResetAt',
        'aiLimit',
        'exportUsageThisMonth',
        'usageResetAt',
        'exportLimitMonthly',
        'billingNotes',
      ] as any,
    });

    if (!organization?.documentId) {
      return null;
    }

    const invitations = await strapi.documents(
      'api::organization-invitation.organization-invitation' as any,
    ).findMany({
      filters: {
        organization: {
          documentId: organizationDocumentId,
        },
        status: 'pending',
      },
      populate: {
        organizationRole: true,
        invitedBy: true,
      },
      sort: ['invitedAt:desc'],
    });

    const organizationRecord = organization as any;
    return {
      organization: {
        documentId: organization.documentId,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        plan: organization.plan,
        planStatus: organizationRecord.planStatus || 'active',
        planExpiresAt: organizationRecord.planExpiresAt || null,
        gracePeriodEndsAt: organizationRecord.gracePeriodEndsAt || null,
        planUpdatedAt: organizationRecord.planUpdatedAt || null,
        aiUsageThisMonth: Number(organizationRecord.aiUsageThisMonth || 0),
        aiResetAt: organizationRecord.aiResetAt || null,
        aiLimit: typeof organizationRecord.aiLimit === 'number' ? organizationRecord.aiLimit : null,
        exportUsageThisMonth: Number(organizationRecord.exportUsageThisMonth || 0),
        usageResetAt: organizationRecord.usageResetAt || null,
        exportLimitMonthly:
          typeof organizationRecord.exportLimitMonthly === 'number'
            ? organizationRecord.exportLimitMonthly
            : null,
        billingNotes: organizationRecord.billingNotes || null,
      },
      invitations: invitations.map((invitation: any) => ({
        documentId: invitation.documentId,
        email: invitation.email,
        invitedAt: invitation.invitedAt,
        status: invitation.status,
        workspaceProjectDocumentId: invitation.workspaceProjectDocumentId || null,
        workspaceName: invitation.workspaceName || null,
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
      })),
    };
  },

  async auditLogs(organizationDocumentId: string) {
    const organization = await strapi.documents('api::organization.organization').findFirst({
      filters: {
        documentId: organizationDocumentId,
      },
      fields: [
        'documentId',
        'name',
        'slug',
        'status',
        'plan',
        'planStatus',
        'planExpiresAt',
        'gracePeriodEndsAt',
        'planUpdatedAt',
        'aiUsageThisMonth',
        'aiResetAt',
        'aiLimit',
        'exportUsageThisMonth',
        'usageResetAt',
        'exportLimitMonthly',
        'billingNotes',
      ] as any,
    });

    if (!organization?.documentId) {
      return null;
    }

    const organizationRecord = organization as any;
    return {
      organization: {
        documentId: organization.documentId,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        plan: organization.plan,
        planStatus: organizationRecord.planStatus || 'active',
        planExpiresAt: organizationRecord.planExpiresAt || null,
        gracePeriodEndsAt: organizationRecord.gracePeriodEndsAt || null,
        planUpdatedAt: organizationRecord.planUpdatedAt || null,
        aiUsageThisMonth: Number(organizationRecord.aiUsageThisMonth || 0),
        aiResetAt: organizationRecord.aiResetAt || null,
        aiLimit: typeof organizationRecord.aiLimit === 'number' ? organizationRecord.aiLimit : null,
        exportUsageThisMonth: Number(organizationRecord.exportUsageThisMonth || 0),
        usageResetAt: organizationRecord.usageResetAt || null,
        exportLimitMonthly:
          typeof organizationRecord.exportLimitMonthly === 'number'
            ? organizationRecord.exportLimitMonthly
            : null,
        billingNotes: organizationRecord.billingNotes || null,
      },
      logs: await getAuditLogs(organizationDocumentId),
    };
  },

  async billingRequests() {
    return {
      billingRequests: await getBillingRequests(),
    };
  },
});
