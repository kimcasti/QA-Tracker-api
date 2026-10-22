import { errors } from '@strapi/utils';
import { authorizeReportRunSnapshot } from '../policies/tenant-access';

const RUN = 'api::test-run.test-run';
const JOB = 'api::automation-job.automation-job';
const fields = ['id', 'runId', 'state', 'finishedAt', 'completedCount', 'cases', 'outcomes'];

function positivePageValue(value: unknown, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value))) {
    throw new errors.ValidationError('La paginación debe usar enteros positivos.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new errors.ValidationError('Paginación fuera de rango.');
  return parsed;
}

export default {
  async jobs(ctx: any) {
    const page = positivePageValue(ctx.query?.page, 1);
    const pageSize = positivePageValue(ctx.query?.pageSize, 100, 100);
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new errors.ValidationError('Paginación fuera de rango.');
    if (!ctx.state.user?.id) throw new errors.UnauthorizedError('Authentication is required.');
    const run: any = await strapi.documents(RUN).findOne({
      documentId: ctx.params.documentId,
      fields: ['documentId'],
      populate: { organization: { fields: ['documentId'] }, project: {
        fields: ['documentId'], populate: { organization: { fields: ['documentId'] } },
      } },
    } as any);
    if (!run?.project?.documentId) throw new errors.NotFoundError('Ejecución no encontrada.');
    await authorizeReportRunSnapshot(ctx, run, strapi);
    const [jobs, total] = await strapi.db.query(JOB).findWithCount({
      where: { runId: run.documentId, projectId: run.project.documentId, state: 'completed' },
      orderBy: { id: 'asc' }, select: fields, offset, limit: pageSize,
    });
    return {
      jobs: jobs.map((job: any) => ({
        id: job.id, runId: job.runId, state: job.state, finishedAt: job.finishedAt,
        completedCount: job.completedCount,
        cases: Array.isArray(job.cases) ? job.cases.map((item: any) => ({
          caseId: item.caseId, resultId: item.resultId, reference: item.reference,
        })) : [],
        outcomes: Array.isArray(job.outcomes) ? job.outcomes.map((item: any) => ({
          automationReference: item.automationReference, status: item.status,
        })) : [],
      })),
      pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
    };
  },
};
