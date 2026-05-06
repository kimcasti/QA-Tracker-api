import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type ExternalParticipantPayload = {
  name?: string;
  role?: string;
  email?: string | null;
  organization?: unknown;
  sourceProject?: unknown;
};

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

function normalizeParticipantData(payload: ExternalParticipantPayload) {
  return {
    name: String(payload.name || '').trim(),
    role: String(payload.role || '').trim(),
    email: String(payload.email || '').trim() || null,
  };
}

async function resolveOrganizationDocumentId(userId: number, payload: ExternalParticipantPayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::external-participant.external-participant',
    {
      organization: payload.organization,
      project: payload.sourceProject,
    },
  );

  if (
    requestedOrganizationDocumentId &&
    !allowedOrganizationDocumentIds.includes(requestedOrganizationDocumentId)
  ) {
    throw new errors.ForbiddenError('Cross-organization access is not allowed.');
  }

  return requestedOrganizationDocumentId ?? allowedOrganizationDocumentIds[0];
}

async function ensureEntityAccess(userId: number, documentId: string) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  const existing = await strapi.documents('api::external-participant.external-participant').findOne({
    documentId,
    populate: {
      organization: {
        fields: ['documentId'],
      },
      sourceProject: {
        fields: ['documentId'],
      },
    },
  });

  if (!existing) {
    throw new errors.NotFoundError('External participant not found.');
  }

  if (
    existing.organization?.documentId &&
    !allowedOrganizationDocumentIds.includes(existing.organization.documentId)
  ) {
    throw new errors.ForbiddenError('Cross-organization access is not allowed.');
  }

  return existing;
}

export default factories.createCoreController(
  'api::external-participant.external-participant',
  () => ({
    async find(ctx) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const memberships = await getUserMemberships(strapi, userId);
      const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

      const documents = allowedOrganizationDocumentIds.length
        ? await strapi.documents('api::external-participant.external-participant').findMany({
            filters: {
              organization: {
                documentId: {
                  $in: allowedOrganizationDocumentIds,
                },
              },
            },
            populate: {
              organization: {
                fields: ['documentId', 'name'],
              },
              sourceProject: {
                fields: ['documentId', 'name', 'key'],
              },
            },
            sort: ['name:asc'],
          })
        : [];

      ctx.body = { data: documents };
    },

    async create(ctx) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const payload = (ctx.request.body?.data || {}) as ExternalParticipantPayload;
      const normalized = normalizeParticipantData(payload);

      if (!normalized.name) {
        throw new errors.ValidationError('External participant name is required.');
      }

      const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);
      const sourceProjectDocumentId = extractRelationDocumentId(payload.sourceProject);

      const created = await strapi.documents('api::external-participant.external-participant').create({
        data: {
          ...normalized,
          organization: organizationDocumentId,
          sourceProject: sourceProjectDocumentId,
        },
        populate: {
          organization: {
            fields: ['documentId', 'name'],
          },
          sourceProject: {
            fields: ['documentId', 'name', 'key'],
          },
        },
      });

      ctx.body = { data: created };
    },

    async update(ctx) {
      const userId = ctx.state.user?.id;
      const documentId = ctx.params.documentId || ctx.params.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      if (!documentId) {
        throw new errors.ValidationError('External participant documentId is required.');
      }

      const existing = await ensureEntityAccess(userId, documentId);
      const payload = (ctx.request.body?.data || {}) as ExternalParticipantPayload;
      const normalized = normalizeParticipantData(payload);
      const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
        ...payload,
        organization: payload.organization ?? existing.organization?.documentId,
        sourceProject: payload.sourceProject ?? existing.sourceProject?.documentId,
      });
      const sourceProjectDocumentId =
        extractRelationDocumentId(payload.sourceProject) ?? existing.sourceProject?.documentId ?? null;

      const updated = await strapi.documents('api::external-participant.external-participant').update({
        documentId,
        data: {
          ...normalized,
          organization: organizationDocumentId,
          sourceProject: sourceProjectDocumentId,
        },
        populate: {
          organization: {
            fields: ['documentId', 'name'],
          },
          sourceProject: {
            fields: ['documentId', 'name', 'key'],
          },
        },
      });

      ctx.body = { data: updated };
    },

    async delete(ctx) {
      const userId = ctx.state.user?.id;
      const documentId = ctx.params.documentId || ctx.params.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      if (!documentId) {
        throw new errors.ValidationError('External participant documentId is required.');
      }

      await ensureEntityAccess(userId, documentId);
      const deleted = await strapi.documents('api::external-participant.external-participant').delete({
        documentId,
      });

      ctx.body = { data: deleted };
    },
  }),
);
