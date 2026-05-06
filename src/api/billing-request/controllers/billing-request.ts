import { errors } from '@strapi/utils';
import { createSubscriptionEvent } from '../../../utils/subscription-events';
import { getUserMemberships } from '../../../utils/tenant';

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeOptionalInteger(value: unknown) {
  if (value === null || value === '' || typeof value === 'undefined') {
    return null;
  }

  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new errors.ValidationError('Numeric upgrade context is not valid.');
  }

  return normalized;
}

function normalizeOptionalPrice(value: unknown) {
  if (value === null || value === '' || typeof value === 'undefined') {
    return null;
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new errors.ValidationError('Price is not valid.');
  }

  return normalized;
}

export default {
  async requestUpgrade(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const memberships = await getUserMemberships(strapi, userId);
    const activeMembership = memberships[0];
    const organizationDocumentId = activeMembership?.organization?.documentId;

    if (!organizationDocumentId) {
      throw new errors.ForbiddenError('An active organization membership is required.');
    }

    const requestedPlan = String(ctx.request.body?.data?.requestedPlan || '').trim();
    const source = normalizeText(ctx.request.body?.data?.source);
    const notes = normalizeText(ctx.request.body?.data?.notes);
    const currentCount = normalizeOptionalInteger(ctx.request.body?.data?.currentCount);
    const limitValue = normalizeOptionalInteger(ctx.request.body?.data?.limitValue);
    const priceMonthlyUsd = normalizeOptionalPrice(ctx.request.body?.data?.priceMonthlyUsd);

    if (!['growth', 'enterprise'].includes(requestedPlan)) {
      throw new errors.ValidationError('Requested plan is not valid.');
    }

    const organization = await strapi.documents('api::organization.organization').findOne({
      documentId: organizationDocumentId,
      fields: ['documentId', 'plan', 'planStatus', 'name'],
    });

    if (!organization?.documentId) {
      throw new errors.NotFoundError('Organization not found.');
    }

    const created = await strapi.documents('api::billing-request.billing-request' as any).create({
      data: {
        requestedPlan,
        status: 'pending',
        source,
        requestedAt: new Date().toISOString(),
        currentCount,
        limitValue,
        priceMonthlyUsd,
        notes,
        organization: organizationDocumentId,
        requestedBy: userId,
      },
    });

    await createSubscriptionEvent(strapi, {
      changedByUserId: userId,
      eventType: 'upgrade_requested',
      organizationDocumentId,
      previousPlan: (organization.plan || 'starter') as any,
      nextPlan: requestedPlan as any,
      previousPlanStatus: (organization.planStatus || 'active') as any,
      nextPlanStatus: (organization.planStatus || 'active') as any,
      effectiveAt: new Date().toISOString(),
      paymentMethod: 'whatsapp',
      notes:
        notes ||
        `Upgrade requested from ${source || 'unknown-source'} to ${requestedPlan} by ${
          ctx.state.user?.email || ctx.state.user?.username || `user-${userId}`
        }.`,
    });

    ctx.body = {
      data: {
        documentId: created.documentId,
        requestedPlan,
        status: created.status,
        organization: {
          documentId: organization.documentId,
          name: organization.name,
        },
      },
    };
  },
};
