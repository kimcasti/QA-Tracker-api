import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type DeliveryActivityTemplatePayload = {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  organization?: unknown;
  project?: unknown;
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

function normalizeDeliveryActivityTemplateData(payload: DeliveryActivityTemplatePayload) {
  return {
    name: payload.name || '',
    description: payload.description || null,
    isActive: typeof payload.isActive === 'boolean' ? payload.isActive : true,
  };
}

async function resolveOrganizationDocumentId(
  userId: number,
  payload: DeliveryActivityTemplatePayload,
) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::delivery-activity-template.delivery-activity-template',
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
};

export default factories.createCoreController(
  'api::delivery-activity-template.delivery-activity-template' as any,
  () => ({
    async create(ctx) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const payload = (ctx.request.body?.data || {}) as DeliveryActivityTemplatePayload;
      const projectDocumentId = extractRelationDocumentId(payload.project);

      if (!projectDocumentId) {
        throw new errors.ValidationError('Delivery activity template project is required.');
      }

      const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

      const created = await strapi
        .documents('api::delivery-activity-template.delivery-activity-template' as any)
        .create({
          data: {
            ...normalizeDeliveryActivityTemplateData(payload),
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
        throw new errors.ValidationError('Delivery activity template documentId is required.');
      }

      const existing = (await strapi
        .documents('api::delivery-activity-template.delivery-activity-template' as any)
        .findOne({
          documentId,
          populate: {
            organization: true,
            project: true,
          } as any,
        })) as any;

      if (!existing) {
        throw new errors.NotFoundError('Delivery activity template not found.');
      }

      const payload = (ctx.request.body?.data || {}) as DeliveryActivityTemplatePayload;
      const projectDocumentId =
        extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

      if (!projectDocumentId) {
        throw new errors.ValidationError('Delivery activity template project is required.');
      }

      const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
        ...payload,
        project: payload.project ?? existing.project?.documentId,
        organization: payload.organization ?? existing.organization?.documentId,
      });

      const updated = await strapi
        .documents('api::delivery-activity-template.delivery-activity-template' as any)
        .update({
          documentId,
          data: {
            ...normalizeDeliveryActivityTemplateData(payload),
            organization: organizationDocumentId,
            project: projectDocumentId,
          } as any,
          populate: responsePopulate as any,
        });

      ctx.body = { data: updated };
    },
  }),
);
