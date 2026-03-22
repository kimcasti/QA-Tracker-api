import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type ProjectStoryMapPayload = {
  snapshot?: string;
  organization?: unknown;
  project?: unknown;
};

function normalizeProjectStoryMapData(payload: ProjectStoryMapPayload) {
  return {
    snapshot: (payload.snapshot || '').trim(),
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

async function resolveOrganizationDocumentId(userId: number, payload: ProjectStoryMapPayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::project-story-map.project-story-map',
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

export default factories.createCoreController(
  'api::project-story-map.project-story-map',
  () => ({
    async create(ctx) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const payload = (ctx.request.body?.data || {}) as ProjectStoryMapPayload;
      const projectDocumentId = extractRelationDocumentId(payload.project);

      if (!projectDocumentId) {
        throw new errors.ValidationError('Story Map project is required.');
      }

      const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

      const created = await strapi.documents('api::project-story-map.project-story-map').create({
        data: {
          ...normalizeProjectStoryMapData(payload),
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
        throw new errors.ValidationError('Story Map documentId is required.');
      }

      const existing = await strapi.documents('api::project-story-map.project-story-map').findOne({
        documentId,
        populate: {
          organization: true,
          project: true,
        },
      });

      if (!existing) {
        throw new errors.NotFoundError('Story Map not found.');
      }

      const payload = (ctx.request.body?.data || {}) as ProjectStoryMapPayload;
      const projectDocumentId =
        extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

      if (!projectDocumentId) {
        throw new errors.ValidationError('Story Map project is required.');
      }

      const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
        ...payload,
        project: payload.project ?? existing.project?.documentId,
        organization: payload.organization ?? existing.organization?.documentId,
      });

      const updated = await strapi.documents('api::project-story-map.project-story-map').update({
        documentId,
        data: {
          ...normalizeProjectStoryMapData(payload),
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
  }),
);
