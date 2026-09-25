import { errors } from '@strapi/utils';
import { findAccessibleProject } from '../../automation-ingestion/controllers/automation-ingestion';
import { catalogInput, digest, fail, LEASE_MS, positiveId, referenceProblem, requiredString, validateOutcomes, type SelectedCase } from './protocol';

const RUNNER = 'api::automation-runner.automation-runner' as any;
const JOB = 'api::automation-job.automation-job' as any;
const CONNECTION = 'api::automation-connection.automation-connection' as any;
const db = (uid: any) => strapi.db.query(uid);
const now = () => new Date().toISOString();
const online = (r: any) => Date.now() - new Date(r.lastSeenAt).getTime() < LEASE_MS;
const publicJob = (j: any) => j && ({
  id: j.id, runId: j.runId, runnerId: j.runnerId, state: j.state, cases: j.cases,
  catalogHash: j.catalogHash, completedCount: j.completedCount, message: j.message,
  startedAt: j.startedAt, finishedAt: j.finishedAt, outcomes: j.outcomes,
});
async function lock(trx: any, uid: any, id: number) {
  await trx(strapi.db.metadata.get(uid).tableName).where({ id }).forUpdate().first();
}
async function expire(runner: any) {
  if (online(runner)) return;
  await db(JOB).updateMany({
    where: { runnerId: runner.id, state: { $in: ['pending', 'running'] } },
    data: { state: 'interrupted', activeRun: null, activeRunner: null, finishedAt: now(), message: 'Ejecutor desconectado. No se repetirá el trabajo.' },
  });
}
async function runAccess(userId: number, runId: string) {
  const run: any = await strapi.documents('api::test-run.test-run').findOne({
    documentId: requiredString(runId, 'Ejecución'),
    populate: { project: true, results: { populate: { testCase: { populate: { project: true, functionality: { populate: { module: true } } } } } } } as any,
  });
  if (!run?.project?.documentId) throw new errors.NotFoundError('Ejecución no encontrada.');
  await findAccessibleProject(userId, { projectDocumentId: run.project.documentId });
  return run;
}
async function projectCases(projectId: string): Promise<any[]> {
  return strapi.documents('api::test-case.test-case').findMany({
    filters: { project: { documentId: projectId }, automationStatus: 'automated', automationTool: 'playwright' },
    fields: ['documentId', 'automationReference'],
  }) as any;
}
function eligible(run: any, runner: any, allCases: any[]) {
  return (run.results || []).filter((row: any) => row.testCase?.project?.documentId === run.project.documentId &&
    row.testCase?.automationStatus === 'automated' && row.testCase?.automationTool === 'playwright')
    .map((row: any) => {
      const reference = row.testCase.automationReference || '';
      return { resultId: row.documentId, caseId: row.testCase.documentId, reference, title: row.testCase.title,
        module: row.testCase.functionality?.module?.name || 'Sin módulo',
        problem: referenceProblem(reference, runner?.catalog || [], allCases.map(c => c.automationReference)) };
    });
}
async function authenticatedRunner(ctx: any, action: (runner: any, trx: any) => Promise<any>) {
  const connection = ctx.state.automationConnection;
  const body = ctx.request.body?.data || {};
  const sessionHash = digest(requiredString(body.session, 'Sesión'));
  return strapi.db.transaction(async ({ trx }) => {
    // The connection lock also serializes registration with all operations from this folder.
    await lock(trx, CONNECTION, connection.id);
    const runner = await db(RUNNER).findOne({ where: { connectionId: connection.id, sessionHash } });
    if (!runner) throw new errors.ForbiddenError('Sesión del ejecutor inválida.');
    await expire(runner);
    return action(runner, trx);
  });
}

export default {
  async sweep() {
    const jobs = await db(JOB).findMany({ where: { state: { $in: ['pending', 'running'] } } });
    for (const id of new Set(jobs.map((job: any) => job.runnerId))) {
      const runner = await db(RUNNER).findOne({ where: { id } });
      if (!runner) continue;
      await strapi.db.transaction(async ({ trx }) => {
        await lock(trx, CONNECTION, runner.connectionId);
        const fresh = await db(RUNNER).findOne({ where: { id } });
        const connection = await db(CONNECTION).findOne({ where: { id: runner.connectionId } });
        const active = connection?.state === 'active' && new Date(connection.expiresAt).getTime() > Date.now();
        if (fresh) await expire(active ? fresh : { ...fresh, lastSeenAt: '1970-01-01' });
      });
    }
  },
  async register(ctx: any) {
    const connection = ctx.state.automationConnection;
    const body = ctx.request.body?.data || {};
    const catalog = catalogInput(body.catalog);
    const sessionHash = digest(requiredString(body.session, 'Sesión'));
    return strapi.db.transaction(async ({ trx }) => {
      await lock(trx, CONNECTION, connection.id);
      const existing = await db(RUNNER).findOne({ where: { connectionId: connection.id } });
      if (existing && online(existing) && existing.sessionHash !== sessionHash) fail('Ya hay un ejecutor activo en esta carpeta.');
      if (existing) await expire(existing);
      const data = { connectionId: connection.id, projectId: connection.projectId, label: connection.label,
        sessionHash, lastSeenAt: now(), catalog, catalogHash: digest(catalog) };
      const runner = existing
        ? await db(RUNNER).update({ where: { id: existing.id }, data })
        : await db(RUNNER).create({ data });
      return { id: runner.id, catalogHash: runner.catalogHash };
    });
  },
  async poll(ctx: any) {
    return authenticatedRunner(ctx, async runner => {
      const body = ctx.request.body?.data || {};
      await db(RUNNER).update({ where: { id: runner.id }, data: { lastSeenAt: now() } });
      let job = await db(JOB).findOne({ where: { runnerId: runner.id, state: { $in: ['pending', 'running'] } }, orderBy: { id: 'asc' } });
      if (job && body.jobId === job.id && job.state === 'running') {
        const count = Number(body.completedCount);
        if (Number.isInteger(count) && count >= job.completedCount && count <= job.cases.length) {
          job = await db(JOB).update({ where: { id: job.id }, data: { completedCount: count } });
        }
      }
      // Heartbeats never claim work. Only the idle loop can claim once.
      if (job?.state === 'pending' && body.claim === true) {
        const run: any = await strapi.documents('api::test-run.test-run').findOne({
          documentId: job.runId, populate: { project: true, results: { populate: { testCase: true } } } as any,
        });
        const valid = run?.status === 'draft' && run.project?.documentId === runner.projectId &&
          job.cases.every((selected: SelectedCase) => run.results?.some((row: any) =>
            row.documentId === selected.resultId && row.testCase?.documentId === selected.caseId &&
            row.testCase.automationReference === selected.reference && row.testCase.automationStatus === 'automated' &&
            row.testCase.automationTool === 'playwright'));
        if (!valid) {
          await db(JOB).update({ where: { id: job.id }, data: { state: 'interrupted', activeRun: null,
            activeRunner: null, finishedAt: now(), message: 'La ejecución o sus casos cambiaron antes de iniciar.' } });
          return { job: null, claimed: false };
        }
        const changed = await db(JOB).updateMany({ where: { id: job.id, state: 'pending' },
          data: { state: 'running', startedAt: now() } });
        if (changed.count !== 1) return { job: null };
        job = await db(JOB).findOne({ where: { id: job.id } });
        return { job: publicJob(job), claimed: true };
      }
      return { job: publicJob(job), claimed: false };
    });
  },
  async interrupt(ctx: any) {
    return authenticatedRunner(ctx, async runner => {
      const { jobId } = ctx.request.body?.data || {};
      positiveId(jobId);
      await db(JOB).updateMany({ where: { id: jobId, runnerId: runner.id, state: { $in: ['pending', 'running'] } },
        data: { state: 'interrupted', activeRun: null, activeRunner: null, finishedAt: now(), message: 'El ejecutor interrumpió el trabajo. Revise los reportes locales.' } });
      return { interrupted: true };
    });
  },
  async inspect(ctx: any) {
    const run = await runAccess(ctx.state.user.id, ctx.params.runId);
    const runners = await db(RUNNER).findMany({ where: { projectId: run.project.documentId } });
    const visible = [];
    for (const runner of runners) {
      const connection = await db(CONNECTION).findOne({ where: { id: runner.connectionId } });
      const connected = connection?.state === 'active' && new Date(connection.expiresAt).getTime() > Date.now();
      await strapi.db.transaction(async ({ trx }) => {
        await lock(trx, CONNECTION, runner.connectionId);
        const fresh = await db(RUNNER).findOne({ where: { id: runner.id } });
        if (fresh) await expire(connected ? fresh : { ...fresh, lastSeenAt: '1970-01-01' });
      });
      const busy = await db(JOB).findOne({ where: { activeRunner: runner.id } });
      visible.push({ id: runner.id, label: runner.label, online: Boolean(connected && online(runner)), busy: Boolean(busy), catalog: runner.catalog });
    }
    const allCases = await projectCases(run.project.documentId);
    return { runners: visible, cases: eligible(run, null, allCases).map(({ problem, ...item }: any) => item),
      duplicateReferences: allCases.map(c => c.automationReference).filter((ref, index, all) => all.indexOf(ref) !== index),
      jobs: (await db(JOB).findMany({ where: { runId: run.documentId, projectId: run.project.documentId }, orderBy: { id: 'desc' }, limit: 20 }))
        .map(job => ({ ...publicJob(job), outcomes: undefined })),
      canRun: run.status === 'draft' };
  },
  async details(ctx: any) {
    const run = await runAccess(ctx.state.user.id, ctx.params.runId);
    const job = await db(JOB).findOne({ where: { id: positiveId(Number(ctx.params.jobId)), runId: run.documentId, projectId: run.project.documentId } });
    if (!job) throw new errors.NotFoundError('Trabajo no encontrado.');
    return publicJob(job);
  },
  async enqueue(ctx: any) {
    const body = ctx.request.body?.data || {};
    if (Object.keys(body).some(key => !['runnerId', 'requestId', 'caseIds'].includes(key))) fail('El trabajo no admite comandos ni opciones adicionales.');
    const run = await runAccess(ctx.state.user.id, ctx.params.runId);
    const requestKey = run.documentId + ':' + requiredString(body.requestId, 'Identificador', 80);
    positiveId(body.runnerId);
    if (!Array.isArray(body.caseIds) || !body.caseIds.length || body.caseIds.length > 200 ||
      new Set(body.caseIds).size !== body.caseIds.length) fail('Selecciona entre 1 y 200 casos únicos.');
    const runner = await db(RUNNER).findOne({ where: { id: body.runnerId, projectId: run.project.documentId } });
    if (!runner) fail('Ejecutor no encontrado.');
    return strapi.db.transaction(async ({ trx }) => {
      await lock(trx, CONNECTION, runner.connectionId);
      // Serialize enqueues for the same execution, even when different runners are selected.
      await lock(trx, 'api::test-run.test-run', run.id);
      const previous = await db(JOB).findOne({ where: { requestKey } });
      if (previous) {
        const sameCases = JSON.stringify(previous.cases.map((c: SelectedCase) => c.caseId).sort()) === JSON.stringify([...body.caseIds].sort());
        if (previous.runnerId !== runner.id || !sameCases) fail('Este identificador ya se usó con otra selección.');
        return publicJob(previous);
      }
      const freshRun = await runAccess(ctx.state.user.id, run.documentId);
      if (freshRun.status !== 'draft') fail('La ejecución debe estar en borrador.');
      const fresh = await db(RUNNER).findOne({ where: { id: runner.id } });
      await expire(fresh);
      const connection = await db(CONNECTION).findOne({ where: { id: runner.connectionId } });
      if (!online(fresh) || connection?.state !== 'active' || new Date(connection.expiresAt).getTime() <= Date.now()) fail('Ejecutor desconectado.');
      const active = await db(JOB).findOne({ where: { $or: [{ activeRun: run.documentId }, { activeRunner: runner.id }] } });
      if (active) fail('Ya existe un trabajo activo para esta ejecución o ejecutor.');
      const candidates = eligible(freshRun, fresh, await projectCases(run.project.documentId));
      const selected = body.caseIds.map((id: string) => {
        const matches = candidates.filter((c: any) => c.caseId === id);
        if (matches.length !== 1 || matches[0].problem) fail('Caso ausente, referencia inválida o ambigua: ' + id);
        const { problem, ...selectedCase } = matches[0];
        return selectedCase;
      });
      return publicJob(await db(JOB).create({ data: { runnerId: runner.id, projectId: run.project.documentId,
        runId: run.documentId, requestedBy: ctx.state.user.id, requestKey, activeRun: run.documentId,
        activeRunner: runner.id, state: 'pending', cases: selected, catalogHash: fresh.catalogHash, completedCount: 0 } }));
    });
  },
  async complete(ctx: any) {
    return authenticatedRunner(ctx, async (runner, trx) => {
      const body = ctx.request.body?.data || {};
      positiveId(body.jobId);
      const job = await db(JOB).findOne({ where: { id: body.jobId, runnerId: runner.id } });
      if (!job) throw new errors.NotFoundError('Trabajo no encontrado.');
      const outcomes = validateOutcomes(body.results, job.cases);
      const receiptHash = digest(outcomes);
      if (job.state === 'completed') {
        if (job.receiptHash !== receiptHash) fail('El trabajo ya tiene otros resultados.');
        return publicJob(job);
      }
      if (!['running', 'interrupted'].includes(job.state)) fail('El trabajo no se ha iniciado.');
      const initialRun = await runAccess(ctx.state.user.id, job.runId);
      await lock(trx, 'api::test-run.test-run', initialRun.id);
      const run = await runAccess(ctx.state.user.id, job.runId);
      if (run.project.documentId !== runner.projectId || job.projectId !== runner.projectId) fail('Trabajo de otro proyecto.');
      // A delayed outbox must never overwrite a newer execution.
      const newer = await db(JOB).findOne({ where: { runId: job.runId, id: { $gt: job.id } } });
      if (newer || run.status !== 'draft') fail('La ejecución cambió; conserva el reporte local para revisión.');
      for (const selected of job.cases as SelectedCase[]) {
        const row = run.results.find((r: any) => r.documentId === selected.resultId && r.testCase?.documentId === selected.caseId);
        if (!row || row.testCase.project?.documentId !== runner.projectId) fail('El caso ya no pertenece a esta ejecución.');
        const result = outcomes.find(o => o.automationReference === selected.reference)!;
        // Patch only selected existing rows: preserve ordering, bugs and every other result.
        await strapi.documents('api::test-run-result.test-run-result').update({ documentId: selected.resultId,
          data: { result: result.status === 'passed' ? 'passed' : result.status === 'failed' ? 'failed' : 'not_executed',
            notes: result.notes, evidenceImage: result.evidenceImage } });
        await strapi.documents('api::test-case.test-case').update({ documentId: selected.caseId,
          data: { lastAutomationStatus: result.status, lastAutomationRunAt: now() } });
      }
      return publicJob(await db(JOB).update({ where: { id: job.id }, data: { state: 'completed', completedCount: outcomes.length,
        activeRun: null, activeRunner: null, receiptHash, outcomes, finishedAt: now(), message: null } }));
    });
  },
};
