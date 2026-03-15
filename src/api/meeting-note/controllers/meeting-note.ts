import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type MeetingNotePayload = {
  date?: string;
  time?: string;
  participants?: string;
  notes?: string;
  aiSummary?: string | null;
  aiDecisions?: string | null;
  aiActions?: string | null;
  aiNextSteps?: string | null;
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

function normalizeMeetingNoteData(payload: MeetingNotePayload) {
  return {
    date: payload.date || '',
    time: payload.time || '',
    participants: payload.participants || '',
    notes: payload.notes || '',
    aiSummary: payload.aiSummary || null,
    aiDecisions: payload.aiDecisions || null,
    aiActions: payload.aiActions || null,
    aiNextSteps: payload.aiNextSteps || null,
  };
}

async function resolveOrganizationDocumentId(userId: number, payload: MeetingNotePayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::meeting-note.meeting-note',
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

export default factories.createCoreController('api::meeting-note.meeting-note', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as MeetingNotePayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Meeting note project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

    const created = await strapi.documents('api::meeting-note.meeting-note').create({
      data: {
        ...normalizeMeetingNoteData(payload),
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
      throw new errors.ValidationError('Meeting note documentId is required.');
    }

    const existing = await strapi.documents('api::meeting-note.meeting-note').findOne({
      documentId,
      populate: {
        organization: true,
        project: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Meeting note not found.');
    }

    const payload = (ctx.request.body?.data || {}) as MeetingNotePayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Meeting note project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await strapi.documents('api::meeting-note.meeting-note').update({
      documentId,
      data: {
        ...normalizeMeetingNoteData(payload),
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
