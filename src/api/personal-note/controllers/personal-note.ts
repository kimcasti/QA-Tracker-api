import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { getUserMemberships } from '../../../utils/tenant';

type PersonalNotePayload = {
  activityDate?: string;
  title?: string;
  description?: string;
};

function normalizePersonalNoteData(payload: PersonalNotePayload) {
  return {
    activityDate: (payload.activityDate || '').trim(),
    title: (payload.title || '').trim(),
    description: (payload.description || '').trim(),
  };
}

async function getActiveOrganizationDocumentId(userId: number) {
  const memberships = await getUserMemberships(strapi, userId);
  const organizationDocumentId = memberships[0]?.organization?.documentId;

  if (!organizationDocumentId) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  return organizationDocumentId;
}

async function getOwnedPersonalNoteOrThrow(documentId: string, userId: number) {
  const existing = await strapi.documents('api::personal-note.personal-note' as any).findOne({
    documentId,
    populate: {
      organization: true,
      owner: true,
    },
  });

  if (!existing) {
    throw new errors.NotFoundError('Personal note not found.');
  }

  const activeOrganizationDocumentId = await getActiveOrganizationDocumentId(userId);

  if (
    existing.organization?.documentId !== activeOrganizationDocumentId ||
    existing.owner?.id !== userId
  ) {
    throw new errors.NotFoundError('Personal note not found.');
  }

  return existing;
}

export default factories.createCoreController('api::personal-note.personal-note' as any, () => ({
  async find(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const organizationDocumentId = await getActiveOrganizationDocumentId(userId);
    const notes = await strapi.documents('api::personal-note.personal-note' as any).findMany({
      filters: {
        organization: {
          documentId: {
            $eq: organizationDocumentId,
          },
        },
        owner: {
          id: {
            $eq: userId,
          },
        },
      } as any,
      sort: ['activityDate:desc', 'updatedAt:desc'],
      fields: ['activityDate', 'title', 'description', 'createdAt', 'updatedAt'],
    });

    ctx.body = { data: notes };
  },

  async findOne(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const documentId = ctx.params.documentId || ctx.params.id;
    if (!documentId) {
      throw new errors.ValidationError('Personal note documentId is required.');
    }

    const note = await getOwnedPersonalNoteOrThrow(documentId, userId);
    ctx.body = { data: note };
  },

  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const normalized = normalizePersonalNoteData((ctx.request.body?.data || {}) as PersonalNotePayload);

    if (!normalized.activityDate) {
      throw new errors.ValidationError('Activity date is required.');
    }

    if (!normalized.title) {
      throw new errors.ValidationError('Title is required.');
    }

    if (!normalized.description) {
      throw new errors.ValidationError('Description is required.');
    }

    const organizationDocumentId = await getActiveOrganizationDocumentId(userId);

    const created = await strapi.documents('api::personal-note.personal-note' as any).create({
      data: {
        ...normalized,
        organization: organizationDocumentId,
        owner: userId,
      },
      fields: ['activityDate', 'title', 'description', 'createdAt', 'updatedAt'],
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
      throw new errors.ValidationError('Personal note documentId is required.');
    }

    const existing = await getOwnedPersonalNoteOrThrow(documentId, userId);
    const payload = (ctx.request.body?.data || {}) as PersonalNotePayload;
    const normalized = normalizePersonalNoteData({
      activityDate: payload.activityDate || existing.activityDate,
      title: payload.title || existing.title,
      description: payload.description || existing.description,
    });

    if (!normalized.activityDate) {
      throw new errors.ValidationError('Activity date is required.');
    }

    if (!normalized.title) {
      throw new errors.ValidationError('Title is required.');
    }

    if (!normalized.description) {
      throw new errors.ValidationError('Description is required.');
    }

    const updated = await strapi.documents('api::personal-note.personal-note' as any).update({
      documentId,
      data: normalized,
      fields: ['activityDate', 'title', 'description', 'createdAt', 'updatedAt'],
    });

    ctx.body = { data: updated };
  },

  async delete(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const documentId = ctx.params.documentId || ctx.params.id;
    if (!documentId) {
      throw new errors.ValidationError('Personal note documentId is required.');
    }

    await getOwnedPersonalNoteOrThrow(documentId, userId);
    const deleted = await strapi.documents('api::personal-note.personal-note' as any).delete({
      documentId,
    });

    ctx.body = { data: deleted };
  },
}));
