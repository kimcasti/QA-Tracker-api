import type { Core } from '@strapi/strapi';

const relationId = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const relation = value as { documentId?: string; connect?: (string | { documentId: string })[] };
  const connected = relation.connect?.[0];
  return relation.documentId || (typeof connected === 'string' ? connected : connected?.documentId);
};

// All document-service case writes share the assignment batch's project lock.
// This also protects against a new case acquiring a reference during a batch.
export function installTestCaseProjectLock(strapi: Core.Strapi) {
  strapi.documents.use(async (context, next) => {
    if (context.uid !== 'api::test-case.test-case' || !['create', 'update', 'delete'].includes(context.action)) return next();
    const params = context.params as { documentId?: string; data?: { project?: unknown } };
    const existing = params.documentId ? await strapi.documents('api::test-case.test-case').findOne({
      documentId: params.documentId, fields: ['documentId'], populate: { project: { fields: ['documentId'] } },
    }) : null;
    const projectIds = [...new Set([relationId(params.data?.project), existing?.project?.documentId].filter(Boolean))];
    if (!projectIds.length) return next();
    const projects = await strapi.db.query('api::project.project').findMany({
      where: { documentId: { $in: projectIds } }, orderBy: { id: 'asc' },
    });
    return strapi.db.transaction(async ({ trx }) => {
      for (const project of projects) {
        await trx(strapi.db.metadata.get('api::project.project').tableName).where({ id: project.id }).forUpdate().first();
      }
      return next();
    });
  });
}
