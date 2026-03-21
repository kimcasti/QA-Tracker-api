import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { getUserMemberships } from '../../../utils/tenant';

type ProjectPayload = {
  name?: string;
  key?: string;
  description?: string;
  version?: string;
  status?: 'active' | 'paused' | 'completed';
  icon?: string;
  logoDataUrl?: string | null;
  teamMembers?: unknown;
  purpose?: string;
  coreRequirements?: unknown;
  businessRules?: string;
  aiProjectInsights?: string;
  aiWireframeBrief?: string;
  organization?: string;
};

function normalizeProjectData(payload: ProjectPayload) {
  return {
    name: payload.name || '',
    key: payload.key || '',
    description: payload.description || '',
    version: payload.version || '',
    status: payload.status || 'active',
    icon: payload.icon || '',
    logoDataUrl: payload.logoDataUrl ?? null,
    teamMembers: Array.isArray(payload.teamMembers) ? payload.teamMembers : [],
    purpose: payload.purpose || '',
    coreRequirements: Array.isArray(payload.coreRequirements) ? payload.coreRequirements : [],
    businessRules: payload.businessRules || '',
    aiProjectInsights: payload.aiProjectInsights || '',
    aiWireframeBrief: payload.aiWireframeBrief || '',
  };
}

async function resolveOrganizationDocumentId(userId: number, requestedOrganization?: string) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = memberships
    .map(membership => membership.organization?.documentId)
    .filter((value): value is string => Boolean(value));

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  if (requestedOrganization && allowedOrganizationDocumentIds.includes(requestedOrganization)) {
    return requestedOrganization;
  }

  return allowedOrganizationDocumentIds[0];
}

export default factories.createCoreController('api::project.project', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as ProjectPayload;
    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload.organization);

    const created = await strapi.documents('api::project.project').create({
      data: {
        ...normalizeProjectData(payload),
        organization: organizationDocumentId,
      },
      populate: {
        organization: true,
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
      throw new errors.ValidationError('Project documentId is required.');
    }

    const existing = await strapi.documents('api::project.project').findOne({
      documentId,
      populate: {
        organization: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Project not found.');
    }

    const payload = (ctx.request.body?.data || {}) as ProjectPayload;
    const organizationDocumentId = await resolveOrganizationDocumentId(
      userId,
      existing.organization?.documentId || payload.organization,
    );

    const updated = await strapi.documents('api::project.project').update({
      documentId,
      data: {
        ...normalizeProjectData(payload),
        organization: organizationDocumentId,
      },
      populate: {
        organization: true,
      },
    });

    ctx.body = { data: updated };
  },
}));
