import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type SprintPayload = {
  name?: string;
  startDate?: string;
  endDate?: string;
  status?: 'planned' | 'in_progress' | 'completed';
  objective?: string;
  organization?: unknown;
  project?: unknown;
};

function normalizeSprintData(payload: SprintPayload) {
  return {
    name: payload.name || '',
    startDate: payload.startDate || '',
    endDate: payload.endDate || '',
    status: payload.status || 'planned',
    objective: payload.objective || '',
  };
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

async function resolveOrganizationDocumentId(userId: number, payload: SprintPayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::sprint.sprint',
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

export default factories.createCoreController('api::sprint.sprint', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as SprintPayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Sprint project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

    const created = await strapi.documents('api::sprint.sprint').create({
      data: {
        ...normalizeSprintData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
      },
      populate: {
        organization: true,
        project: true,
      },
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
      throw new errors.ValidationError('Sprint documentId is required.');
    }

    const existing = await strapi.documents('api::sprint.sprint').findOne({
      documentId,
      populate: {
        organization: true,
        project: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Sprint not found.');
    }

    const payload = (ctx.request.body?.data || {}) as SprintPayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Sprint project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await strapi.documents('api::sprint.sprint').update({
      documentId,
      data: {
        ...normalizeSprintData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
      },
      populate: {
        organization: true,
        project: true,
      },
    });

    ctx.body = { data: updated };
  },
}));
