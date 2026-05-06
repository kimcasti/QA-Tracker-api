import { errors } from '@strapi/utils';
import { sendOrganizationInvitationEmail } from '../../../utils/mail';
import { assertOrganizationLimitAvailable } from '../../../utils/plan-enforcement';
import {
  ensureOrganizationKeepsOwner,
  setUserBlockedState,
  syncUserAccessState,
  toNumericUserId,
} from '../../../utils/organization-membership-admin';
import { recomputeOrganizationUsageSnapshot } from '../../../utils/organization-usage';
import { createSubscriptionEvent } from '../../../utils/subscription-events';
import { logSuperadminAudit } from '../../../utils/superadmin-audit';

async function getMembershipWithOrganization(membershipDocumentId: string) {
  return strapi.documents('api::organization-membership.organization-membership').findOne({
    documentId: membershipDocumentId,
    populate: {
      organization: true,
      organizationRole: true,
      user: true,
    },
  });
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function parseOptionalDateInput(value: unknown, fieldName: string) {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const normalized = new Date(String(value));
  if (Number.isNaN(normalized.getTime())) {
    throw new errors.ValidationError(`${fieldName} is not a valid date.`);
  }

  return normalized.toISOString();
}

function parseOptionalNonNegativeInteger(value: unknown, fieldName: string) {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new errors.ValidationError(`${fieldName} must be a non-negative integer.`);
  }

  return normalized;
}

function normalizeBillingRequestStatus(value: unknown) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new errors.ValidationError('Billing request status is required.');
  }

  if (!['pending', 'contacted', 'approved', 'rejected', 'fulfilled'].includes(normalized)) {
    throw new errors.ValidationError('Billing request status is not valid.');
  }

  return normalized as 'pending' | 'contacted' | 'approved' | 'rejected' | 'fulfilled';
}

function getSubscriptionEventType(input: {
  previousPlan?: string | null;
  nextPlan?: string | null;
  previousPlanStatus?: string | null;
  nextPlanStatus?: string | null;
  gracePeriodEndsAt?: string | null;
}) {
  if (input.previousPlan !== input.nextPlan) {
    if (input.nextPlan === 'starter' && input.previousPlan && input.previousPlan !== 'starter') {
      return 'downgraded_to_starter' as const;
    }

    if (input.previousPlan === 'starter' && input.nextPlan && input.nextPlan !== 'starter') {
      return 'plan_upgraded' as const;
    }

    return 'manual_adjustment' as const;
  }

  if (input.previousPlanStatus !== input.nextPlanStatus) {
    if (input.nextPlanStatus === 'past_due') {
      return input.gracePeriodEndsAt ? ('grace_started' as const) : ('marked_past_due' as const);
    }

    if (input.nextPlanStatus === 'canceled') {
      return 'plan_canceled' as const;
    }

    if (input.nextPlanStatus === 'active') {
      return 'plan_renewed' as const;
    }
  }

  return 'manual_adjustment' as const;
}

async function getRoleForOrganization(roleDocumentId: string, organizationDocumentId: string) {
  return strapi.documents('api::organization-role.organization-role').findFirst({
    filters: {
      documentId: roleDocumentId,
      organization: {
        documentId: organizationDocumentId,
      },
    },
    fields: ['documentId', 'code', 'name'],
  });
}

async function getOrganizationDbRecord(organizationDocumentId: string) {
  return strapi.db.query('api::organization.organization').findOne({
    where: {
      documentId: organizationDocumentId,
    },
  });
}

async function getOrganizationContactUser(organizationDocumentId: string) {
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

  if (ownerMembership?.user?.id) {
    return ownerMembership.user;
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

  return fallbackMembership?.user || null;
}

export default {
  async organizations(ctx) {
    const data = await strapi.service('api::superadmin.superadmin').organizations();
    ctx.body = data;
  },

  async billingRequests(ctx) {
    const data = await strapi.service('api::superadmin.superadmin').billingRequests();
    ctx.body = data;
  },

  async updateOrganization(ctx) {
    const organizationDocumentId = String(ctx.params?.documentId || '').trim();
    const nextPlan = String(ctx.request.body?.data?.plan || '').trim();
    const nextStatus = String(ctx.request.body?.data?.status || '').trim();
    const nextPlanStatus = String(ctx.request.body?.data?.planStatus || '').trim();
    const nextPlanExpiresAt = parseOptionalDateInput(ctx.request.body?.data?.planExpiresAt, 'planExpiresAt');
    const nextGracePeriodEndsAt = parseOptionalDateInput(
      ctx.request.body?.data?.gracePeriodEndsAt,
      'gracePeriodEndsAt',
    );
    const nextAiLimit = parseOptionalNonNegativeInteger(ctx.request.body?.data?.aiLimit, 'aiLimit');
    const nextExportLimitMonthly = parseOptionalNonNegativeInteger(
      ctx.request.body?.data?.exportLimitMonthly,
      'exportLimitMonthly',
    );
    const nextContactNumber = normalizeOptionalText(ctx.request.body?.data?.contactNumber);
    const nextBillingNotes = normalizeOptionalText(ctx.request.body?.data?.billingNotes);
    const paymentMethod = normalizeOptionalText(ctx.request.body?.data?.paymentMethod);
    const externalReference = normalizeOptionalText(ctx.request.body?.data?.externalReference);

    if (!organizationDocumentId) {
      throw new errors.ValidationError('Organization documentId is required.');
    }

    if (!['starter', 'growth', 'enterprise'].includes(nextPlan)) {
      throw new errors.ValidationError('Plan is not valid.');
    }

    if (!['active', 'inactive'].includes(nextStatus)) {
      throw new errors.ValidationError('Status is not valid.');
    }

    if (!['active', 'past_due', 'canceled'].includes(nextPlanStatus)) {
      throw new errors.ValidationError('Plan status is not valid.');
    }

    if (
      paymentMethod &&
      !['manual_transfer', 'nequi', 'whatsapp', 'wompi', 'mercadopago', 'other'].includes(
        paymentMethod,
      )
    ) {
      throw new errors.ValidationError('Payment method is not valid.');
    }

    const organization = await strapi.documents('api::organization.organization').findOne({
      documentId: organizationDocumentId,
      fields: [
        'documentId',
        'name',
        'plan',
        'status',
        'planStatus',
        'planExpiresAt',
        'gracePeriodEndsAt',
        'aiLimit',
        'exportLimitMonthly',
        'billingNotes',
      ] as any,
    });

    if (!organization?.documentId) {
      throw new errors.NotFoundError('Organization not found.');
    }

    const previousPlan = organization.plan || null;
    const previousStatus = organization.status || null;
    const previousPlanStatus = organization.planStatus || null;
    const previousPlanExpiresAt = (organization as any).planExpiresAt || null;
    const previousGracePeriodEndsAt = (organization as any).gracePeriodEndsAt || null;
    const previousAiLimit =
      typeof (organization as any).aiLimit === 'number' ? (organization as any).aiLimit : null;
    const previousExportLimitMonthly =
      typeof (organization as any).exportLimitMonthly === 'number'
        ? (organization as any).exportLimitMonthly
        : null;
    const contactUser = await getOrganizationContactUser(organizationDocumentId);
    const previousContactNumber = contactUser?.contactNumber || null;
    const previousBillingNotes = (organization as any).billingNotes || null;
    const resolvedPlanExpiresAt =
      typeof nextPlanExpiresAt === 'undefined' ? previousPlanExpiresAt : nextPlanExpiresAt;
    const resolvedGracePeriodEndsAt =
      typeof nextGracePeriodEndsAt === 'undefined'
        ? previousGracePeriodEndsAt
        : nextGracePeriodEndsAt;
    const resolvedAiLimit = typeof nextAiLimit === 'undefined' ? previousAiLimit : nextAiLimit;
    const resolvedExportLimitMonthly =
      typeof nextExportLimitMonthly === 'undefined'
        ? previousExportLimitMonthly
        : nextExportLimitMonthly;
    const now = new Date().toISOString();

    await strapi.documents('api::organization.organization').update({
      documentId: organizationDocumentId,
      data: {
        plan: nextPlan as 'starter' | 'growth' | 'enterprise',
        status: nextStatus as 'active' | 'inactive',
        planStatus: nextPlanStatus as 'active' | 'past_due' | 'canceled',
        planExpiresAt: resolvedPlanExpiresAt,
        gracePeriodEndsAt: resolvedGracePeriodEndsAt,
        aiLimit: resolvedAiLimit,
        exportLimitMonthly: resolvedExportLimitMonthly,
        billingNotes: nextBillingNotes,
        planUpdatedAt: now,
      },
    });

    if (contactUser?.id && previousContactNumber !== nextContactNumber) {
      await strapi.plugin('users-permissions').service('user').edit(contactUser.id, {
        contactNumber: nextContactNumber,
      });
    }

    await createSubscriptionEvent(strapi, {
      changedByUserId: ctx.state.user?.id,
      eventType: getSubscriptionEventType({
        previousPlan,
        nextPlan,
        previousPlanStatus,
        nextPlanStatus,
        gracePeriodEndsAt: resolvedGracePeriodEndsAt,
      }),
      organizationDocumentId,
      previousPlan: previousPlan as any,
      nextPlan: nextPlan as any,
      previousPlanStatus: previousPlanStatus as any,
      nextPlanStatus: nextPlanStatus as any,
      effectiveAt: now,
      planExpiresAt: resolvedPlanExpiresAt,
      gracePeriodEndsAt: resolvedGracePeriodEndsAt,
      paymentMethod: (paymentMethod || null) as any,
      externalReference,
      notes: nextBillingNotes,
    });

    await recomputeOrganizationUsageSnapshot(organizationDocumentId);

    await logSuperadminAudit({
      actorUserId: ctx.state.user?.id,
      organizationDocumentId,
      action: 'organization.updated',
      targetType: 'organization',
      targetDocumentId: organizationDocumentId,
      targetLabel: organization.name || organizationDocumentId,
      details: {
        previousPlan,
        nextPlan,
        previousStatus,
        nextStatus,
        previousPlanStatus,
        nextPlanStatus,
        previousPlanExpiresAt,
        nextPlanExpiresAt: resolvedPlanExpiresAt,
        previousGracePeriodEndsAt,
        nextGracePeriodEndsAt: resolvedGracePeriodEndsAt,
        previousAiLimit,
        nextAiLimit: resolvedAiLimit,
        previousExportLimitMonthly,
        nextExportLimitMonthly: resolvedExportLimitMonthly,
        previousContactNumber,
        nextContactNumber,
        previousBillingNotes,
        nextBillingNotes,
        paymentMethod,
        externalReference,
      },
    });

    ctx.body = await strapi.service('api::superadmin.superadmin').organizations();
  },

  async memberships(ctx) {
    const organizationDocumentId = String(ctx.params?.documentId || '').trim();

    if (!organizationDocumentId) {
      throw new errors.ValidationError('Organization documentId is required.');
    }

    const data = await strapi.service('api::superadmin.superadmin').memberships(organizationDocumentId);

    if (!data) {
      throw new errors.NotFoundError('Organization not found.');
    }

    ctx.body = data;
  },

  async invitations(ctx) {
    const organizationDocumentId = String(ctx.params?.documentId || '').trim();

    if (!organizationDocumentId) {
      throw new errors.ValidationError('Organization documentId is required.');
    }

    const data = await strapi.service('api::superadmin.superadmin').invitations(organizationDocumentId);

    if (!data) {
      throw new errors.NotFoundError('Organization not found.');
    }

    ctx.body = data;
  },

  async auditLogs(ctx) {
    const organizationDocumentId = String(ctx.params?.documentId || '').trim();

    if (!organizationDocumentId) {
      throw new errors.ValidationError('Organization documentId is required.');
    }

    const data = await strapi.service('api::superadmin.superadmin').auditLogs(organizationDocumentId);

    if (!data) {
      throw new errors.NotFoundError('Organization not found.');
    }

    ctx.body = data;
  },

  async invite(ctx) {
    const organizationDocumentId = String(ctx.params?.documentId || '').trim();
    const email = normalizeEmail(ctx.request.body?.data?.email);
    const roleDocumentId = String(ctx.request.body?.data?.roleDocumentId || '').trim();

    if (!organizationDocumentId) {
      throw new errors.ValidationError('Organization documentId is required.');
    }

    if (!email) {
      throw new errors.ValidationError('Email is required.');
    }

    if (!roleDocumentId) {
      throw new errors.ValidationError('Role is required.');
    }

    const organization = await strapi.documents('api::organization.organization').findFirst({
      filters: { documentId: organizationDocumentId },
      fields: ['documentId', 'name'],
    });

    if (!organization?.documentId) {
      throw new errors.NotFoundError('Organization not found.');
    }

    const role = await getRoleForOrganization(roleDocumentId, organizationDocumentId);

    if (!role?.documentId) {
      throw new errors.ValidationError('The selected role is not valid for this organization.');
    }

    const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { email },
    });

    if (existingUser) {
      const activeMembership = await strapi.documents('api::organization-membership.organization-membership').findFirst({
        filters: {
          organization: { documentId: organizationDocumentId },
          user: { id: existingUser.id },
          isActive: true,
        },
      });

      if (activeMembership?.documentId) {
        throw new errors.ValidationError('This email already has active access in the organization.');
      }
    }

    const duplicateInvitation = await strapi.documents(
      'api::organization-invitation.organization-invitation' as any,
    ).findFirst({
      filters: {
        organization: { documentId: organizationDocumentId },
        email,
        status: 'pending',
      },
    });

    if (duplicateInvitation?.documentId) {
      throw new errors.ValidationError('There is already a pending invitation for this email.');
    }

    await assertOrganizationLimitAvailable({
      organizationDocumentId,
      limitKey: 'users',
      resourceLabel: 'usuarios',
    });

    const organizationDbRecord = await getOrganizationDbRecord(organizationDocumentId);

    if (!organizationDbRecord?.id) {
      throw new errors.NotFoundError('Organization not found.');
    }

    const created = await strapi.db
      .query('api::organization-invitation.organization-invitation' as any)
      .create({
        data: {
          email,
          invitedAt: new Date().toISOString(),
          status: 'pending',
          organization: organizationDbRecord.id,
          organizationRole: role.id,
          invitedBy: ctx.state.user?.id,
        },
      });

    const invitationDocumentId = created?.documentId;

    if (!invitationDocumentId) {
      throw new errors.ApplicationError('The invitation could not be created.');
    }

    try {
      await sendOrganizationInvitationEmail({
        invitationDocumentId,
        recipientEmail: email,
        organizationName: organization.name || 'Organization',
        roleName: role.name || 'Viewer',
        inviterEmail: ctx.state.user?.email,
        inviterName: ctx.state.user?.username,
        invitationStatus: 'new',
      });
    } catch (mailError) {
      await strapi.documents('api::organization-invitation.organization-invitation' as any).delete({
        documentId: invitationDocumentId,
      });

      throw new errors.ApplicationError(
        mailError instanceof Error ? mailError.message : 'The invitation email could not be sent.',
      );
    }

    if (existingUser?.id) {
      await setUserBlockedState(existingUser.id, false);
    }

    await logSuperadminAudit({
      actorUserId: ctx.state.user?.id,
      organizationDocumentId,
      action: 'invitation.created',
      targetType: 'organization-invitation',
      targetDocumentId: invitationDocumentId,
      targetLabel: email,
      details: {
        email,
        roleName: role.name || null,
      },
    });

    ctx.body = await strapi.service('api::superadmin.superadmin').invitations(organizationDocumentId);
  },

  async updateMembershipRole(ctx) {
    const membershipDocumentId = String(ctx.params?.documentId || '').trim();
    const roleDocumentId = String(ctx.request.body?.data?.roleDocumentId || '').trim();

    if (!membershipDocumentId || !roleDocumentId) {
      throw new errors.ValidationError('Membership and role are required.');
    }

    const membership = await getMembershipWithOrganization(membershipDocumentId);

    if (!membership?.documentId || !membership.organization?.documentId) {
      throw new errors.NotFoundError('Membership not found.');
    }

    const nextRole = await getRoleForOrganization(roleDocumentId, membership.organization.documentId);

    if (!nextRole?.documentId) {
      throw new errors.ValidationError('The selected role is not valid for this organization.');
    }

    if (membership.isActive && membership.organizationRole?.code === 'owner' && nextRole.code !== 'owner') {
      await ensureOrganizationKeepsOwner(membership.organization.documentId, membership.documentId);
    }

    const previousRoleName = membership.organizationRole?.name || null;

    await strapi.documents('api::organization-membership.organization-membership').update({
      documentId: membershipDocumentId,
      data: {
        organizationRole: nextRole.documentId,
      },
    });

    await logSuperadminAudit({
      actorUserId: ctx.state.user?.id,
      organizationDocumentId: membership.organization.documentId,
      action: 'membership.role-updated',
      targetType: 'organization-membership',
      targetDocumentId: membershipDocumentId,
      targetLabel: membership.user?.email || membership.user?.username || membershipDocumentId,
      details: {
        previousRoleName,
        nextRoleName: nextRole.name || null,
      },
    });

    ctx.body = await strapi.service('api::superadmin.superadmin').memberships(membership.organization.documentId);
  },

  async deactivateMembership(ctx) {
    const membershipDocumentId = String(ctx.params?.documentId || '').trim();

    if (!membershipDocumentId) {
      throw new errors.ValidationError('Membership is required.');
    }

    const membership = await getMembershipWithOrganization(membershipDocumentId);

    if (!membership?.documentId || !membership.organization?.documentId) {
      throw new errors.NotFoundError('Membership not found.');
    }

    if (membership.isActive && membership.organizationRole?.code === 'owner') {
      await ensureOrganizationKeepsOwner(membership.organization.documentId, membership.documentId);
    }

    await strapi.documents('api::organization-membership.organization-membership').update({
      documentId: membershipDocumentId,
      data: {
        isActive: false,
      },
    });

    const targetUserId = toNumericUserId(membership.user?.id);
    if (targetUserId) {
      await syncUserAccessState(targetUserId);
    }

    await logSuperadminAudit({
      actorUserId: ctx.state.user?.id,
      organizationDocumentId: membership.organization.documentId,
      action: 'membership.deactivated',
      targetType: 'organization-membership',
      targetDocumentId: membershipDocumentId,
      targetLabel: membership.user?.email || membership.user?.username || membershipDocumentId,
      details: {
        roleName: membership.organizationRole?.name || null,
      },
    });

    ctx.body = await strapi.service('api::superadmin.superadmin').memberships(membership.organization.documentId);
  },

  async reactivateMembership(ctx) {
    const membershipDocumentId = String(ctx.params?.documentId || '').trim();

    if (!membershipDocumentId) {
      throw new errors.ValidationError('Membership is required.');
    }

    const membership = await getMembershipWithOrganization(membershipDocumentId);

    if (!membership?.documentId || !membership.organization?.documentId) {
      throw new errors.NotFoundError('Membership not found.');
    }

    await strapi.documents('api::organization-membership.organization-membership').update({
      documentId: membershipDocumentId,
      data: {
        isActive: true,
      },
    });

    const targetUserId = toNumericUserId(membership.user?.id);
    if (targetUserId) {
      await setUserBlockedState(targetUserId, false);
    }

    await logSuperadminAudit({
      actorUserId: ctx.state.user?.id,
      organizationDocumentId: membership.organization.documentId,
      action: 'membership.reactivated',
      targetType: 'organization-membership',
      targetDocumentId: membershipDocumentId,
      targetLabel: membership.user?.email || membership.user?.username || membershipDocumentId,
      details: {
        roleName: membership.organizationRole?.name || null,
      },
    });

    ctx.body = await strapi.service('api::superadmin.superadmin').memberships(membership.organization.documentId);
  },

  async deleteMembership(ctx) {
    const membershipDocumentId = String(ctx.params?.documentId || '').trim();

    if (!membershipDocumentId) {
      throw new errors.ValidationError('Membership is required.');
    }

    const membership = await getMembershipWithOrganization(membershipDocumentId);

    if (!membership?.documentId || !membership.organization?.documentId) {
      throw new errors.NotFoundError('Membership not found.');
    }

    if (membership.isActive && membership.organizationRole?.code === 'owner') {
      await ensureOrganizationKeepsOwner(membership.organization.documentId, membership.documentId);
    }

    await strapi.documents('api::organization-membership.organization-membership').delete({
      documentId: membershipDocumentId,
    });

    const targetUserId = toNumericUserId(membership.user?.id);
    if (targetUserId) {
      await syncUserAccessState(targetUserId);
    }

    await logSuperadminAudit({
      actorUserId: ctx.state.user?.id,
      organizationDocumentId: membership.organization.documentId,
      action: 'membership.deleted',
      targetType: 'organization-membership',
      targetDocumentId: membershipDocumentId,
      targetLabel: membership.user?.email || membership.user?.username || membershipDocumentId,
      details: {
        roleName: membership.organizationRole?.name || null,
      },
    });

    ctx.body = await strapi.service('api::superadmin.superadmin').memberships(membership.organization.documentId);
  },

  async resendInvitation(ctx) {
    const invitationDocumentId = String(ctx.params?.documentId || '').trim();

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

    try {
      await sendOrganizationInvitationEmail({
        invitationDocumentId,
        recipientEmail: invitation.email,
        organizationName: invitation.organization?.name || 'Organization',
        roleName: invitation.organizationRole?.name || 'Viewer',
        inviterEmail: ctx.state.user?.email,
        inviterName: ctx.state.user?.username,
        invitationStatus: 'resent',
      });
    } catch (mailError) {
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

    await logSuperadminAudit({
      actorUserId: ctx.state.user?.id,
      organizationDocumentId: invitation.organization.documentId,
      action: 'invitation.resent',
      targetType: 'organization-invitation',
      targetDocumentId: invitationDocumentId,
      targetLabel: invitation.email,
      details: {
        roleName: invitation.organizationRole?.name || null,
      },
    });

    ctx.body = await strapi.service('api::superadmin.superadmin').invitations(invitation.organization.documentId);
  },

  async cancelInvitation(ctx) {
    const invitationDocumentId = String(ctx.params?.documentId || '').trim();

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

    if (!invitation?.documentId || !invitation.organization?.documentId) {
      throw new errors.NotFoundError('Invitation not found.');
    }

    await strapi.documents('api::organization-invitation.organization-invitation' as any).update({
      documentId: invitationDocumentId,
      data: {
        status: 'cancelled',
      },
    });

    await logSuperadminAudit({
      actorUserId: ctx.state.user?.id,
      organizationDocumentId: invitation.organization.documentId,
      action: 'invitation.cancelled',
      targetType: 'organization-invitation',
      targetDocumentId: invitationDocumentId,
      targetLabel: invitation.email,
      details: null,
    });

    ctx.body = await strapi.service('api::superadmin.superadmin').invitations(invitation.organization.documentId);
  },

  async updateBillingRequest(ctx) {
    const billingRequestDocumentId = String(ctx.params?.documentId || '').trim();
    const nextStatus = normalizeBillingRequestStatus(ctx.request.body?.data?.status);
    const nextStatusNotes = normalizeOptionalText(ctx.request.body?.data?.statusNotes);
    const paymentMethod = normalizeOptionalText(ctx.request.body?.data?.paymentMethod);
    const externalReference = normalizeOptionalText(ctx.request.body?.data?.externalReference);

    if (!billingRequestDocumentId) {
      throw new errors.ValidationError('Billing request documentId is required.');
    }

    if (
      paymentMethod &&
      !['manual_transfer', 'nequi', 'whatsapp', 'wompi', 'mercadopago', 'other'].includes(
        paymentMethod,
      )
    ) {
      throw new errors.ValidationError('Payment method is not valid.');
    }

    const billingRequest = await strapi
      .documents('api::billing-request.billing-request' as any)
      .findOne({
        documentId: billingRequestDocumentId,
        populate: {
          organization: true,
          requestedBy: true,
        },
      });

    if (!billingRequest?.documentId) {
      throw new errors.NotFoundError('Billing request not found.');
    }

    const billingRequestOrganizationDocumentId = billingRequest.organization?.documentId;

    if (!billingRequestOrganizationDocumentId) {
      throw new errors.ValidationError('Billing request organization is not valid.');
    }

    const handledAt = new Date().toISOString();

    await strapi.documents('api::billing-request.billing-request' as any).update({
      documentId: billingRequestDocumentId,
      data: {
        status: nextStatus,
        statusNotes: nextStatusNotes,
        paymentMethod: paymentMethod || null,
        externalReference,
        handledAt,
        handledBy: ctx.state.user?.id || null,
      },
    });

    await logSuperadminAudit({
      actorUserId: ctx.state.user?.id,
      organizationDocumentId: billingRequestOrganizationDocumentId,
      action: 'billing-request.updated',
      targetType: 'billing-request',
      targetDocumentId: billingRequestDocumentId,
      targetLabel:
        `${billingRequest.organization?.name || 'Organizacion'} -> ${billingRequest.requestedPlan || 'growth'}`.trim(),
      details: {
        previousStatus: billingRequest.status || 'pending',
        nextStatus,
        requestedPlan: billingRequest.requestedPlan || null,
        source: billingRequest.source || null,
        paymentMethod: paymentMethod || null,
        externalReference,
        statusNotes: nextStatusNotes,
      },
    });

    ctx.body = await strapi.service('api::superadmin.superadmin').billingRequests();
  },
};
