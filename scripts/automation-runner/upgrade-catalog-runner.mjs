// Pure transformation used by the updater and tested against the installed runner.
export function upgradeCatalogRunner(original) {
  if (original.includes('catalogRefreshVersion: 1')) return original;
  let source = original;
  const replace = (before, after) => {
    if (!source.includes(before)) throw new Error('Versión del ejecutor no reconocida para detectar referencias. No se modificó qa-runner.mjs.');
    source = source.replace(before, after);
  };
  replace('async function playwright(args, extraEnv = {}) {', 'async function playwright(args, extraEnv = {}, timeoutMs = 60 * 60 * 1000) {');
  replace('const timeout = setTimeout(() => stopChild(), 60 * 60 * 1000);', 'const timeout = setTimeout(() => stopChild(), timeoutMs);');
  replace('async function discover(selectionFile, output = inventoryFile) {', 'async function discover(selectionFile, output = inventoryFile, timeoutMs) {');
  replace("{ QA_RUNNER_CATALOG: output, QA_RUNNER_PROGRESS: '' });", "{ QA_RUNNER_CATALOG: output, QA_RUNNER_PROGRESS: '' }, timeoutMs);");
  replace("environments: environmentConfig.available });", "environments: environmentConfig.available, catalogRefreshVersion: 1 });");
  replace("const { job, claimed } = await request('poll', { claim: true });", "const { job, claimed, catalogRequest } = await request('poll', { claim: true });");
  replace('        if (job && !claimed) {', `        if (catalogRequest) {
          // Discovery is idempotent and isolated from execution/result journals.
          let payload;
          try {
            executionEnv = environmentConfig.forJob(catalogRequest.environment);
            const discovered = await discover(undefined, inventoryFile, 120_000);
            payload = { catalogRequestId: catalogRequest.id, references: discovered.map(test => test.reference) };
          } catch (error) {
            payload = { catalogRequestId: catalogRequest.id, error: String(error.message || error).slice(0, 2000) };
          }
          // Retry only publication, never re-run discovery after a lost response.
          for (let attempt = 0; attempt < 3 && !stopping; attempt++) {
            try { await request('completeCatalog', payload); break; }
            catch (error) {
              if ([400, 401, 403, 404].includes(error.status) || attempt === 2) throw error;
              await delay(1000);
            }
          }
        } else if (job && !claimed) {`);
  return source;
}
