import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type DeliveryUnitPayload = {
  name?: string;
  type?: 'phase' | 'service' | 'maintenance' | 'support' | 'milestone' | 'other';
  baseDescription?: string | null;
  startDate?: string | null;
  estimatedEndDate?: string | null;
  periodLabel?: string | null;
  amount?: number | null;
  status?: 'planned' | 'in_progress' | 'completed' | 'paused' | 'cancelled';
  sortOrder?: number | null;
  activities?: unknown;
  organization?: unknown;
  project?: unknown;
};

function hasOwnProperty<T extends object>(value: T, key: keyof any) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function extractRelationDocumentId(rawValue: unknown): string | null {
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

function normalizeDeliveryUnitData(payload: DeliveryUnitPayload) {
  const data: Record<string, unknown> = {
    name: payload.name || '',
    type: payload.type || 'phase',
    baseDescription: payload.baseDescription || null,
    startDate: payload.startDate || null,
    estimatedEndDate: payload.estimatedEndDate || null,
    periodLabel: payload.periodLabel || null,
    amount:
      typeof payload.amount === 'number' && Number.isFinite(payload.amount) ? payload.amount : null,
    status: payload.status || 'planned',
    sortOrder:
      typeof payload.sortOrder === 'number' && Number.isFinite(payload.sortOrder)
        ? payload.sortOrder
        : 0,
  };

  if (hasOwnProperty(payload, 'activities')) {
    data.activities = normalizeManyRelation(payload.activities) ?? { disconnect: [] };
  }

  return data;
}

function normalizeManyRelation(rawValue: unknown) {
  if (Array.isArray(rawValue)) {
    return {
      set: rawValue.filter(
        (item): item is { documentId: string } =>
          typeof item === 'object' && item !== null && Boolean((item as { documentId?: string }).documentId),
      ),
    };
  }

  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const value = rawValue as {
    connect?: Array<{ documentId?: string }>;
    disconnect?: Array<{ documentId?: string }>;
    set?: Array<{ documentId?: string }>;
  };

  if (Array.isArray(value.set)) {
    return {
      set: value.set.filter(
        (item): item is { documentId: string } => Boolean(item?.documentId),
      ),
    };
  }

  if (Array.isArray(value.connect)) {
    return {
      connect: value.connect.filter(
        (item): item is { documentId: string } => Boolean(item?.documentId),
      ),
    };
  }

  if (Array.isArray(value.disconnect)) {
    return {
      disconnect: value.disconnect.filter(
        (item): item is { documentId: string } => Boolean(item?.documentId),
      ),
    };
  };

  return null;
}

async function resolveOrganizationDocumentId(userId: number, payload: DeliveryUnitPayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::delivery-unit.delivery-unit',
    payload as Record<string, unknown>,
  );

  if (
    requestedOrganizationDocumentId &&
    !allowedOrganizationDocumentIds.includes(requestedOrganizationDocumentId)
  ) {
    throw new errors.ForbiddenError('Cross-organization access is not allowed.');
  }

  return requestedOrganizationDocumentId ?? allowedOrganizationDocumentIds[0];
}

const responsePopulate = {
  project: {
    fields: ['key'],
  },
  activities: {
    fields: ['documentId', 'name', 'description', 'isActive'],
  },
};

export default factories.createCoreController('api::delivery-unit.delivery-unit' as any, () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as DeliveryUnitPayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Delivery unit project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

    const created = await strapi.documents('api::delivery-unit.delivery-unit' as any).create({
      data: {
        ...normalizeDeliveryUnitData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
      } as any,
      populate: responsePopulate as any,
    });

    ctx.body = { data: created };
  },

  async update(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const documentId = ctx.params.documentId || ctx.params.id;
    if (!documentId) {
      throw new errors.ValidationError('Delivery unit documentId is required.');
    }

    const existing = await strapi.documents('api::delivery-unit.delivery-unit' as any).findOne({
      documentId,
      populate: {
        organization: true,
        project: true,
      } as any,
    }) as any;

    if (!existing) {
      throw new errors.NotFoundError('Delivery unit not found.');
    }

    const payload = (ctx.request.body?.data || {}) as DeliveryUnitPayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Delivery unit project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await strapi.documents('api::delivery-unit.delivery-unit' as any).update({
      documentId,
      data: {
        ...normalizeDeliveryUnitData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
      } as any,
      populate: responsePopulate as any,
    });

    ctx.body = { data: updated };
  },
}));
