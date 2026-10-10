import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import { runnerEnvironments } from './runner-environment.mjs';
import { loadConnection, safeUrl } from './qa-connection.mjs';
import { collectResults } from './playwright-evidence.mjs';
import { assertExactSelection, selectTests, testList } from './runner-selection.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const artifacts = path.join(root, 'test-results', 'runner');
const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const reporter = path.join(root, 'scripts', 'runner-reporter.mjs');
const connection = await loadConnection(root);
if (!connection) throw new Error('Ejecuta npm run qa:connect antes de iniciar el ejecutor.');
const apiUrl = safeUrl(connection.apiUrl);
const target = { apiUrl, projectKey: connection.projectKey };
const sameTarget = value => value?.apiUrl === target.apiUrl && value?.projectKey === target.projectKey;
if (process.env.QA_TRACKER_API_URL && safeUrl(process.env.QA_TRACKER_API_URL) !== apiUrl) throw new Error('La API del .env no coincide con la conexion guardada.');
if (process.env.QA_TRACKER_PROJECT_KEY && process.env.QA_TRACKER_PROJECT_KEY !== connection.projectKey) throw new Error('El proyecto no coincide con la conexion guardada.');
const session = randomUUID();
let stopping = false;
let child;
let activeJob;
let completedCount = 0;
let lastContact = Date.now();
const environmentConfig = runnerEnvironments();
let executionEnv = environmentConfig.forJob(environmentConfig.defaultEnvironment);
const env = { ...process.env, E2E_API_MODE: 'real', PLAYWRIGHT_PROJECTS: 'chromium', PLAYWRIGHT_HTML_OPEN: 'never' };
await fs.mkdir(artifacts, { recursive: true });
const inventoryFile = path.join(artifacts, 'catalog-' + session + '.json');

async function request(action, data = {}) {
  const response = await fetch(apiUrl + '/api/automation-runner/' + action, {
    method: 'POST', headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { session, ...data } }), redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = new Error('QA Tracker respondió HTTP ' + response.status + ' (' + action + ').');
    error.status = response.status;
    throw error;
  }
  lastContact = Date.now();
  return (await response.json()).data;
}
function stopChild() {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; stopChild(); });
async function playwright(args, extraEnv = {}) {
  if (stopping) throw new Error('Ejecutor detenido.');
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [cli, 'test', '--config=playwright.e2e.config.ts', '--project=chromium', '--workers=1', '--retries=0',
      '--repeat-each=1', '--no-deps', '--forbid-only', ...args],
    { cwd: root, env: { ...env, ...executionEnv, ...extraEnv }, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: 'inherit' });
    const timeout = setTimeout(() => stopChild(), 60 * 60 * 1000);
    child.once('error', error => { clearTimeout(timeout); child = undefined; reject(error); });
    child.once('exit', code => { clearTimeout(timeout); child = undefined; resolve(code ?? 130); });
  });
}
async function discover(selectionFile, output = inventoryFile) {
  const code = await playwright(['--list', '--reporter=' + reporter, ...(selectionFile ? ['--test-list', selectionFile] : [])],
    { QA_RUNNER_CATALOG: output, QA_RUNNER_PROGRESS: '' });
  if (code !== 0) throw new Error('No se pudo descubrir el catálogo de Playwright.');
  return JSON.parse(await fs.readFile(output, 'utf8'));
}
async function writeJson(file, data) {
  await fs.writeFile(file + '.tmp', JSON.stringify(data, null, 2));
  await fs.rename(file + '.tmp', file);
}
async function deliver(dir) {
  const file = path.join(dir, 'outbox.json');
  const payload = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!sameTarget(payload.target)) throw new Error('Este reporte pertenece a otra API o proyecto.');
  await request('complete', { jobId: payload.jobId, results: payload.results });
  await writeJson(path.join(dir, 'delivered.json'), { at: new Date().toISOString() });
  console.log('Resultados publicados en la ejecución original. Trabajo ' + payload.jobId);
}
async function recover() {
  for (const name of await fs.readdir(artifacts)) {
    if (!/^\d+$/.test(name)) continue;
    const dir = path.join(artifacts, name);
    const journalText = await fs.readFile(path.join(dir, 'job.json'), 'utf8')
      .catch(error => { if (error.code === 'ENOENT') return 'null'; throw error; });
    const journal = JSON.parse(journalText);
    if (!sameTarget(journal?.target)) continue;
    try { await fs.access(path.join(dir, 'delivered.json')); continue; } catch { /* Not delivered yet. */ }
    try { await fs.access(path.join(dir, 'outbox.json')); }
    catch {
      // A journal without a final report is never replayed.
      await request('interrupt', { jobId: Number(name) });
      continue;
    }
    await deliver(dir);
  }
}
async function execute(job) {
  if (['command', 'args', 'env', 'cwd'].some(key => key in job)) throw new Error('El trabajo contiene comandos no permitidos.');
  executionEnv = environmentConfig.forJob(job.environment ?? 'local');
  console.log('Trabajo ' + job.id + ' - ' + executionEnv.PLAYWRIGHT_ENV + ' - ' + executionEnv.PLAYWRIGHT_BASE_URL);
  const dir = path.join(artifacts, String(job.id));
  // Exclusive creation is the local at-most-once journal.
  await fs.mkdir(dir);
  await writeJson(path.join(dir, 'job.json'), { ...job, target });
  const references = job.cases.map(item => item.reference);
  const selected = selectTests(await discover(), references);
  const selectionFile = path.join(dir, 'selection.txt');
  await fs.writeFile(selectionFile, testList(selected));
  assertExactSelection(await discover(selectionFile, path.join(dir, 'preflight.json')), references);
  const reportPath = path.join(dir, 'results.json');
  const progressFile = path.join(dir, 'progress.txt');
  activeJob.progressFile = progressFile;
  const code = await playwright(['--test-list', selectionFile, '--output', path.join(dir, 'artifacts'),
    '--reporter=json,' + reporter], {
    PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath, QA_TRACKER_REPORT_PATH: reportPath,
    QA_RUNNER_CATALOG: path.join(dir, 'executed.json'), QA_RUNNER_PROGRESS: progressFile,
  });
  if (stopping || ![0, 1].includes(code)) throw new Error('Playwright fue interrumpido.');
  assertExactSelection(JSON.parse(await fs.readFile(path.join(dir, 'executed.json'), 'utf8')), references);
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  if (report.errors?.length) throw new Error('El reporte contiene errores globales. Revisa results.json antes de repetir pruebas.');
  const results = await collectResults(report, reportPath);
  assertExactSelection(results.map(result => ({ reference: result.automationReference })), references);
  const payload = { jobId: job.id, target, results };
  if (Buffer.byteLength(JSON.stringify(payload)) > 4.5 * 1024 * 1024) throw new Error('Reporte demasiado grande para publicar.');
  await writeJson(path.join(dir, 'outbox.json'), payload);
  await deliver(dir);
}
const catalog = await discover();
await request('register', { catalog: catalog.map(test => test.reference), environments: environmentConfig.available });
console.log('Ejecutor disponible: ' + connection.projectName + ' - Chromium - ' + environmentConfig.available.join(', '));
// Heartbeats keep the lease alive while discovery, execution or publication is in progress.
const heartbeat = (async () => {
  while (!stopping) {
    await delay(5000);
    if (stopping) break;
    try {
      if (activeJob?.progressFile) {
        try { completedCount = Number(await fs.readFile(activeJob.progressFile, 'utf8')) || completedCount; } catch { /* First test still running. */ }
      }
      const status = await request('poll', { claim: false, jobId: activeJob?.id, completedCount });
      if (activeJob && status.job?.id !== activeJob.id && child) stopChild();
    } catch (error) {
      if (Date.now() - lastContact > 60000 || [401, 403].includes(error.status)) {
        stopChild();
        stopping = true;
        console.error('Se perdió la conexión. Se detiene el ejecutor sin repetir pruebas.');
      }
    }
  }
})();
try {
  if (process.argv[2] === '--resend') {
    const id = process.argv[3];
    if (!/^\d+$/.test(id || '')) throw new Error('Indica el número del trabajo: npm run qa:runner -- --resend 123');
    await deliver(path.join(artifacts, id));
  } else {
    await recover();
    while (!stopping) {
      try {
        const { job, claimed } = await request('poll', { claim: true });
        if (job && !claimed) {
          // Includes a claim whose HTTP response was lost: never guess whether it ran.
          await request('interrupt', { jobId: job.id });
        } else if (job) {
          activeJob = { id: job.id };
          completedCount = 0;
          try { await execute(job); }
          catch (error) {
            console.error(error.message);
            try { await fs.access(path.join(artifacts, String(job.id), 'outbox.json')); }
            catch { await request('interrupt', { jobId: job.id }); }
            // Never claim more work before the existing outbox is delivered.
            await recover();
          } finally { activeJob = undefined; }
        }
        await delay(3000);
      } catch (error) {
        console.error(error.message);
        if ([400, 401, 403, 404].includes(error.status)) throw error;
        await delay(5000);
        await recover();
      }
    }
  }
} finally {
  stopping = true;
  stopChild();
  await heartbeat;
}
