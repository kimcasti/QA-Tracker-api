import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { getUserMemberships, getUserProjectAccessScope } from '../../../utils/tenant';

type ProjectCommentPayload = {
  content?: string;
  isPinned?: boolean;
  project?: unknown;
};

function extractRelationDocumentId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;

  const relation = value as { documentId?: string; connect?: Array<{ documentId?: string }> };
  return relation.documentId || relation.connect?.[0]?.documentId || null;
}

function hasMeaningfulContent(value?: string) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .trim().length > 0;
}

async function getProjectAccessOrThrow(userId: number, projectDocumentId: string) {
  const project = await strapi.documents('api::project.project').findOne({
    documentId: projectDocumentId,
    populate: { organization: true },
  });

  if (!project?.organization?.documentId) {
    throw new errors.NotFoundError('Project not found.');
  }

  const memberships = await getUserMemberships(strapi, userId);
  const membership = memberships.find(
    item => item.organization?.documentId === project.organization?.documentId,
  );
  if (!membership) {
    throw new errors.ForbiddenError('You do not have access to this project.');
  }

  const scope = await getUserProjectAccessScope(strapi, userId, memberships);
  if (scope.hasProjectRestrictions && !scope.allowedProjectDocumentIds.includes(projectDocumentId)) {
    throw new errors.ForbiddenError('Your role is not assigned to this project.');
  }

  return {
    project,
    isModerator: ['owner', 'qa-lead'].includes(membership.organizationRole?.code || ''),
  };
}

async function getCommentOrThrow(documentId: string) {
  const comment = await strapi.documents('api::project-comment.project-comment' as any).findOne({
    documentId,
    populate: { project: { populate: { organization: true } }, author: true },
  });
  if (!comment) throw new errors.NotFoundError('Project comment not found.');
  return comment;
}

export default factories.createCoreController('api::project-comment.project-comment' as any, () => ({
  async find(ctx) {
    const userId = ctx.state.user?.id;
    const projectDocumentId = String(ctx.query?.project || '').trim();
    if (!userId) throw new errors.UnauthorizedError('Authentication is required.');
    if (!projectDocumentId) throw new errors.ValidationError('Project is required.');

    await getProjectAccessOrThrow(userId, projectDocumentId);
    const comments = await strapi.documents('api::project-comment.project-comment' as any).findMany({
      filters: { project: { documentId: { $eq: projectDocumentId } } } as any,
      sort: ['isPinned:desc', 'updatedAt:desc'],
      populate: { author: { fields: ['username', 'email'] }, project: { fields: ['documentId'] } },
    });
    ctx.body = { data: comments };
  },

  async create(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) throw new errors.UnauthorizedError('Authentication is required.');
    const payload = (ctx.request.body?.data || {}) as ProjectCommentPayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);
    if (!projectDocumentId) throw new errors.ValidationError('Project is required.');
    if (!hasMeaningfulContent(payload.content)) {
      throw new errors.ValidationError('Comment content is required.');
    }

    const { project } = await getProjectAccessOrThrow(userId, projectDocumentId);
    const created = await strapi.documents('api::project-comment.project-comment' as any).create({
      data: {
        content: String(payload.content || '').trim(),
        isPinned: false,
        organization: project.organization.documentId,
        project: projectDocumentId,
        author: userId,
      },
      populate: { author: { fields: ['username', 'email'] }, project: { fields: ['documentId'] } },
    });
    ctx.body = { data: created };
  },

  async update(ctx) {
    const userId = ctx.state.user?.id;
    const documentId = ctx.params.documentId || ctx.params.id;
    if (!userId) throw new errors.UnauthorizedError('Authentication is required.');
    if (!documentId) throw new errors.ValidationError('Project comment documentId is required.');
    const existing = await getCommentOrThrow(documentId);
    const { isModerator } = await getProjectAccessOrThrow(userId, existing.project.documentId);
    const isAuthor = existing.author?.id === userId;
    const payload = (ctx.request.body?.data || {}) as ProjectCommentPayload;

    if ('content' in payload && !isAuthor) {
      throw new errors.ForbiddenError('Only the author can edit this comment.');
    }
    if ('isPinned' in payload && !isModerator) {
      throw new errors.ForbiddenError('Only project moderators can pin comments.');
    }
    if ('content' in payload && !hasMeaningfulContent(payload.content)) {
      throw new errors.ValidationError('Comment content is required.');
    }

    const updated = await strapi.documents('api::project-comment.project-comment' as any).update({
      documentId,
      data: {
        ...(typeof payload.content === 'string' ? { content: payload.content.trim() } : {}),
        ...(typeof payload.isPinned === 'boolean' ? { isPinned: payload.isPinned } : {}),
      },
      populate: { author: { fields: ['username', 'email'] }, project: { fields: ['documentId'] } },
    });
    ctx.body = { data: updated };
  },

  async delete(ctx) {
    const userId = ctx.state.user?.id;
    const documentId = ctx.params.documentId || ctx.params.id;
    if (!userId) throw new errors.UnauthorizedError('Authentication is required.');
    if (!documentId) throw new errors.ValidationError('Project comment documentId is required.');
    const existing = await getCommentOrThrow(documentId);
    const { isModerator } = await getProjectAccessOrThrow(userId, existing.project.documentId);
    if (existing.author?.id !== userId && !isModerator) {
      throw new errors.ForbiddenError('Only the author or a project moderator can delete this comment.');
    }
    const deleted = await strapi.documents('api::project-comment.project-comment' as any).delete({ documentId });
    ctx.body = { data: deleted };
  },
}));
