import { errors } from '@strapi/utils';
import { findAccessibleProject } from '../../automation-ingestion/controllers/automation-ingestion';
import { catalogInput, digest, fail, LEASE_MS, positiveId, requiredString } from '../../automation-runner/services/protocol';

export const CATALOG = 'api::automation-catalog.automation-catalog' as any;
const RUNNER = 'api::automation-runner.automation-runner' as any;
const CONNECTION = 'api::automation-connection.automation-connection' as any;
const JOB = 'api::automation-job.automation-job' as any;
const CASE = 'api::test-case.test-case';
const db = (uid: any) => strapi.db.query(uid);
const now = () => new Date().toISOString();
const online = (runner: any) => runner && Date.now() - new Date(runner.lastSeenAt).getTime() < LEASE_MS;
const publicRequest = (row: any) => ({ id: row.id, runnerId: row.runnerId, environment: row.environment,
  state: row.state, requestedAt: row.requestedAt, finishedAt: row.finishedAt,
  references: row.references || [], catalogHash: row.catalogHash, error: row.error });
async function lock(trx: any, uid: any, id: number) {
  await trx(strapi.db.metadata.get(uid).tableName).where({ id }).forUpdate().first();
}
async function projectAccess(ctx: any) {
  return findAccessibleProject(ctx.state.user.id, { projectKey: requiredString(ctx.params.projectKey, 'Proyecto') });
}
export async function expireCatalogRequests(runnerId?: number) {
  await db(CATALOG).updateMany({ where: { ...(runnerId ? { runnerId } : {}),
    state: { $in: ['pending', 'running'] }, requestedAt: { $lt: new Date(Date.now() - 150_000).toISOString() } },
  data: { state: 'failed', activeRunner: null, finishedAt: now(), error: 'La detección venció. Actualiza la conexión e intenta de nuevo.' } });
}
export async function claimCatalogRequest(runner: any, claim: boolean) {
  const request = await db(CATALOG).findOne({ where: { activeRunner: runner.id } });
  if (!request || !claim || request.state !== 'pending') return null;
  if (runner.catalogRefreshVersion !== 1 || !(runner.environments || ['local']).includes(request.environment)) {
    await db(CATALOG).update({ where: { id: request.id }, data: { state: 'failed', activeRunner: null,
      finishedAt: now(), error: 'Actualiza el ejecutor y configura el ambiente seleccionado.' } });
    return null;
  }
  const changed = await db(CATALOG).updateMany({ where: { id: request.id, state: 'pending' }, data: { state: 'running', startedAt: now() } });
  return changed.count === 1 ? { id: request.id, environment: request.environment } : null;
}
export async function completeCatalogRequest(runner: any, body: any) {
  positiveId(body.catalogRequestId);
  const row = await db(CATALOG).findOne({ where: { id: body.catalogRequestId, runnerId: runner.id, projectId: runner.projectId } });
  if (!row) throw new errors.NotFoundError('Solicitud no encontrada.');
  const error = body.error == null ? null : requiredString(body.error, 'Error', 2000);
  const references = error ? [] : catalogInput(body.references, true);
  const hash = digest(references);
  if (row.state === 'completed' && !error && row.catalogHash === hash) return publicRequest(row);
  if (row.state === 'failed' && error && row.error === error) return publicRequest(row);
  if (row.state !== 'running') fail('La solicitud ya no está en curso.');
  const completed = await db(CATALOG).update({ where: { id: row.id }, data: { state: error ? 'failed' : 'completed',
    activeRunner: null, finishedAt: now(), references, catalogHash: error ? null : hash, error } });
  // Keep the execution picker in sync with the latest successfully discovered inventory.
  if (!error) await db(RUNNER).update({ where: { id: runner.id }, data: { catalog: references, catalogHash: hash } });
  return publicRequest(completed);
}
type CatalogCase = {
  documentId: string; title: string; updatedAt?: string; automationReference?: string;
  automationStatus?: string; automationTool?: string; automationType?: 'ui' | 'api' | 'integration' | 'performance'; isAutomated?: boolean;
  functionality?: { name?: string; code?: string; module?: { name?: string } };
};
async function casesForProject(projectId: string): Promise<CatalogCase[]> {
  // Explicit batching: never compare only Strapi's first page.
  const result: CatalogCase[] = [];
  for (let start = 0; ; start += 500) {
    const page = await strapi.documents(CASE).findMany({ filters: { project: { documentId: projectId } },
      fields: ['documentId', 'title', 'updatedAt', 'automationReference', 'automationStatus', 'automationTool', 'automationType', 'isAutomated'],
      populate: { functionality: { fields: ['name', 'code'], populate: { module: { fields: ['name'] } } } },
      sort: 'documentId:asc', start, limit: 500 } as any) as CatalogCase[];
    result.push(...page);
    if (page.length < 500) break;
  }
  return result;
}
const caseSnapshot = (item: CatalogCase) => digest([item.updatedAt || '', item.automationReference || '',
  item.automationStatus || '', item.automationTool || '', item.automationType || '', Boolean(item.isAutomated)]);
const caseView = (item: CatalogCase) => ({ id: item.documentId, title: item.title,
  reference: item.automationReference || '', status: item.automationStatus || (item.isAutomated ? 'automated' : 'not_automated'),
  tool: item.automationTool || '', type: item.automationType || '', snapshot: caseSnapshot(item),
  module: item.functionality?.module?.name || 'Sin módulo', functionality: item.functionality?.name || '',
  functionalityId: item.functionality?.code || '' });

export default {
  async connections(ctx: any) {
    const project = await projectAccess(ctx);
    await expireCatalogRequests();
    const connections = await db(CONNECTION).findMany({ where: { projectId: project.documentId, state: 'active', expiresAt: { $gt: now() } } });
    return Promise.all(connections.map(async (connection: any) => {
      const runner = await db(RUNNER).findOne({ where: { connectionId: connection.id, projectId: project.documentId } });
      const job = runner && await db(JOB).findOne({ where: { activeRunner: runner.id } });
      const refresh = runner && await db(CATALOG).findOne({ where: { activeRunner: runner.id } });
      return { id: connection.id, runnerId: runner?.id || null, label: connection.label,
        online: Boolean(online(runner)), busy: Boolean(job || refresh), compatible: runner?.catalogRefreshVersion === 1,
        environments: runner?.environments || ['local'] };
    }));
  },
  async request(ctx: any) {
    const project = await projectAccess(ctx);
    const body = ctx.request.body?.data || {};
    if (Object.keys(body).some(key => !['runnerId', 'environment', 'requestId'].includes(key))) fail('La detección no admite comandos ni opciones adicionales.');
    positiveId(body.runnerId);
    if (!['local', 'test'].includes(body.environment)) fail('Selecciona Local o Test.');
    const requestKey = project.documentId + ':' + requiredString(body.requestId, 'Identificador', 80);
    const runner = await db(RUNNER).findOne({ where: { id: body.runnerId, projectId: project.documentId } });
    if (!runner) fail('Ejecutor no encontrado.');
    return strapi.db.transaction(async ({ trx }) => {
      await lock(trx, CONNECTION, runner.connectionId);
      await expireCatalogRequests(runner.id);
      const previous = await db(CATALOG).findOne({ where: { requestKey } });
      if (previous) {
        if (previous.runnerId !== runner.id || previous.environment !== body.environment) fail('El identificador ya corresponde a otra selección.');
        return publicRequest(previous);
      }
      const fresh = await db(RUNNER).findOne({ where: { id: runner.id } });
      const connection = await db(CONNECTION).findOne({ where: { id: runner.connectionId } });
      if (!online(fresh) || connection?.state !== 'active' || new Date(connection.expiresAt).getTime() <= Date.now()) fail('Ejecutor desconectado. Inicia npm run qa:runner.');
      if (fresh.catalogRefreshVersion !== 1) fail('Actualiza el ejecutor y reinicia npm run qa:runner.');
      if (!(fresh.environments || ['local']).includes(body.environment)) fail('Ambiente no disponible.');
      if (await db(JOB).findOne({ where: { activeRunner: runner.id } }) || await db(CATALOG).findOne({ where: { activeRunner: runner.id } })) fail('El ejecutor está ocupado. Intenta nuevamente cuando termine.');
      return publicRequest(await db(CATALOG).create({ data: { projectId: project.documentId, runnerId: runner.id,
        requestedBy: ctx.state.user.id, requestKey, environment: body.environment, state: 'pending',
        activeRunner: runner.id, requestedAt: now(), assignmentReceipts: [] } }));
    });
  },
  async details(ctx: any) {
    const project = await projectAccess(ctx);
    await expireCatalogRequests();
    const row = await db(CATALOG).findOne({ where: { id: positiveId(Number(ctx.params.requestId)), projectId: project.documentId } });
    if (!row) throw new errors.NotFoundError('Solicitud no encontrada.');
    return { ...publicRequest(row), cases: row.state === 'completed' ? (await casesForProject(project.documentId)).map(caseView) : [] };
  },
  async assign(ctx: any) {
    const project = await projectAccess(ctx);
    const body = ctx.request.body?.data || {};
    const items = body.assignments as { caseId: string; reference: string; snapshot: string }[];
    if (!Array.isArray(items) || !items.length || items.length > 200 || items.some(item => !item ||
      typeof item.caseId !== 'string' || typeof item.reference !== 'string' || typeof item.snapshot !== 'string') ||
      new Set(items.map(item => item.caseId)).size !== items.length || new Set(items.map(item => item.reference)).size !== items.length) fail('Selecciona entre 1 y 200 vínculos únicos.');
    const attempt = requiredString(body.requestId, 'Identificador', 80);
    const receiptHash = digest([...items].sort((a, b) => a.caseId.localeCompare(b.caseId)));
    const projectRow = await db('api::project.project').findOne({ where: { documentId: project.documentId } });
    return strapi.db.transaction(async ({ trx }) => {
      // One project lock serializes batches, including assignments from different folders.
      await lock(trx, 'api::project.project', projectRow.id);
      const row = await db(CATALOG).findOne({ where: { id: positiveId(Number(ctx.params.requestId)), projectId: project.documentId } });
      if (!row) throw new errors.NotFoundError('Solicitud no encontrada.');
      if (row.state !== 'completed' || row.catalogHash !== body.catalogHash) fail('El catálogo cambió. Actualiza la comparación.');
      const previous = (row.assignmentReceipts || []).find((receipt: any) => receipt.requestId === attempt);
      if (previous) {
        if (previous.hash !== receiptHash) fail('Este intento ya corresponde a otros vínculos.');
        return { saved: previous.caseIds };
      }
      const firstCases = await casesForProject(project.documentId);
      if (firstCases.length) await trx(strapi.db.metadata.get(CASE).tableName)
        .whereIn('document_id', firstCases.map(item => item.documentId)).forUpdate();
      const cases = await casesForProject(project.documentId);
      for (const item of items) {
        const current = cases.find(candidate => candidate.documentId === item.caseId);
        if (!current || caseSnapshot(current) !== item.snapshot) fail('Uno de los casos cambió. Actualiza la comparación antes de guardar.');
        if (row.references.filter((reference: string) => reference === item.reference).length !== 1) fail('Referencia ausente o ambigua en el catálogo.');
        if (cases.some(candidate => candidate.documentId !== item.caseId && candidate.automationReference === item.reference)) fail('La referencia ya está registrada en otro caso. Actualiza la comparación.');
      }
      for (const item of items) {
        const current = cases.find(candidate => candidate.documentId === item.caseId)!;
        const changed = current.automationReference !== item.reference || current.automationTool !== 'playwright';
        await strapi.documents(CASE).update({ documentId: item.caseId, data: {
          automationReference: item.reference, automationTool: 'playwright', automationStatus: 'automated', isAutomated: true,
          automationType: current.automationType || 'ui',
          ...(changed ? { lastAutomationStatus: 'unknown', lastAutomationRunAt: null } : {}),
        } });
      }
      const saved = items.map(item => item.caseId);
      await db(CATALOG).update({ where: { id: row.id }, data: { assignmentReceipts: [...(row.assignmentReceipts || []),
        { requestId: attempt, hash: receiptHash, caseIds: saved, assignedBy: ctx.state.user.id, assignedAt: now(),
          changes: items.map(item => ({ caseId: item.caseId, reference: item.reference,
            previousReference: cases.find(candidate => candidate.documentId === item.caseId)?.automationReference || '' })) }] } });
      return { saved };
    });
  },
};
