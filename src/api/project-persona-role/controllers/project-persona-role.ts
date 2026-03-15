import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type ProjectPersonaRolePayload = {
  name?: string;
  description?: string;
  organization?: unknown;
  project?: unknown;
};

function normalizeProjectPersonaRoleData(payload: ProjectPersonaRolePayload) {
  return {
    name: payload.name || '',
    description: payload.description || '',
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

async function resolveOrganizationDocumentId(userId: number, payload: ProjectPersonaRolePayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::project-persona-role.project-persona-role',
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

export default factories.createCoreController('api::project-persona-role.project-persona-role', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as ProjectPersonaRolePayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Project role project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

    const created = await strapi.documents('api::project-persona-role.project-persona-role').create({
      data: {
        ...normalizeProjectPersonaRoleData(payload),
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
      throw new errors.ValidationError('Project role documentId is required.');
    }

    const existing = await strapi.documents('api::project-persona-role.project-persona-role').findOne({
      documentId,
      populate: {
        organization: true,
        project: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Project role not found.');
    }

    const payload = (ctx.request.body?.data || {}) as ProjectPersonaRolePayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Project role project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await strapi.documents('api::project-persona-role.project-persona-role').update({
      documentId,
      data: {
        ...normalizeProjectPersonaRoleData(payload),
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
