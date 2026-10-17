import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  extractConnectedDocumentId,
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
  getUserProjectAccessScope,
} from '../../../utils/tenant';

type ExternalParticipantPayload = {
  name?: string;
  role?: string;
  email?: string | null;
  organization?: unknown;
  sourceProject?: unknown;
};

function extractRelationDocumentId(rawValue: unknown): string | null {
  return extractConnectedDocumentId(rawValue);
}

function normalizeParticipantData(payload: ExternalParticipantPayload) {
  return {
    name: String(payload.name || '').trim(),
    role: String(payload.role || '').trim(),
    email: String(payload.email || '').trim() || null,
  };
}

async function resolveOrganizationDocumentId(userId: number, payload: ExternalParticipantPayload) {
  for (const key of ['organization', 'sourceProject'] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key) && !extractRelationDocumentId(payload[key])) {
      throw new errors.ValidationError(`Invalid ${key} relation.`);
    }
  }
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::external-participant.external-participant',
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

      const scope = await getUserProjectAccessScope(strapi, userId, memberships);
      // UAT reuses organization-directory contacts; only project-derived contacts
      // require an assignment in restricted organizations.
      const scopeFilter = {
        organization: { documentId: { $in: allowedOrganizationDocumentIds } },
        $or: [
          { organization: { documentId: { $in: scope.unrestrictedOrganizationDocumentIds } } },
          { sourceProject: { documentId: { $in: scope.allowedProjectDocumentIds } } },
          { sourceProject: { documentId: { $null: true } } },
        ],
      };
      const documents = allowedOrganizationDocumentIds.length
        ? await strapi.documents('api::external-participant.external-participant').findMany({
            filters: { $and: [ctx.query?.filters ?? {}, scopeFilter] } as any,
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
        ...(existing.organization?.documentId ? { organization: existing.organization.documentId } : {}),
        ...(existing.sourceProject?.documentId ? { sourceProject: existing.sourceProject.documentId } : {}),
        ...payload,
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
