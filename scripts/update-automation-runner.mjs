import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upgradeCatalogRunner } from './automation-runner/upgrade-catalog-runner.mjs';

// Update an existing qa-automation folder without replacing its connection,
// reporter, evidence handling, recovery logic or project configuration.
const folder = process.argv[2];
if (!folder) throw new Error('Uso: node scripts/update-automation-runner.mjs <ruta a qa-automation>');
const root = path.resolve(folder);
const file = path.join(root, 'scripts', 'qa-runner.mjs');
const original = await fs.readFile(file, 'utf8');
let source = original;
if (!source.includes("from './runner-environment.mjs'")) {
  const replace = (search, replacement) => {
    if (typeof search === 'string' ? !source.includes(search) : !search.test(source)) {
      throw new Error('Versión del ejecutor no reconocida. No se modificó qa-runner.mjs.');
    }
    source = source.replace(search, replacement);
  };
  replace("import dotenv from 'dotenv';", "import dotenv from 'dotenv';\nimport { runnerEnvironments } from './runner-environment.mjs';");
  replace(/const (?:environment = \(process\.env\.PLAYWRIGHT_ENV[\s\S]*?|env = \{[\s\S]*?)await fs\.mkdir\(artifacts/, `const environmentConfig = runnerEnvironments();
let executionEnv = environmentConfig.forJob(environmentConfig.defaultEnvironment);
const env = { ...process.env, E2E_API_MODE: 'real', PLAYWRIGHT_PROJECTS: 'chromium', PLAYWRIGHT_HTML_OPEN: 'never' };
await fs.mkdir(artifacts`);
  replace('env: { ...env, ...extraEnv }', 'env: { ...env, ...executionEnv, ...extraEnv }');
  replace("  const dir = path.join(artifacts, String(job.id));", `  executionEnv = environmentConfig.forJob(job.environment ?? 'local');
  console.log('Trabajo ' + job.id + ' - ' + executionEnv.PLAYWRIGHT_ENV + ' - ' + executionEnv.PLAYWRIGHT_BASE_URL);
  const dir = path.join(artifacts, String(job.id));`);
  replace("await request('register', { catalog: catalog.map(test => test.reference) });", "await request('register', { catalog: catalog.map(test => test.reference), environments: environmentConfig.available });");
  replace(/console\.log\('Ejecutor disponible:[^\n]*\);/, "console.log('Ejecutor disponible: ' + connection.projectName + ' - Chromium - ' + environmentConfig.available.join(', '));");
}
source = upgradeCatalogRunner(source);
const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'automation-runner', 'runner-environment.mjs');
if (source !== original) {
  await fs.writeFile(file + '.before-environments.bak', original, { flag: 'wx' }).catch(error => {
    if (error.code !== 'EEXIST') throw error;
  });
  await fs.writeFile(file + '.before-catalog.bak', original, { flag: 'wx' }).catch(error => {
    if (error.code !== 'EEXIST') throw error;
  });
}
await fs.copyFile(helper, path.join(root, 'scripts', 'runner-environment.mjs'));
if (source !== original) await fs.writeFile(file, source);
console.log('Ejecutor actualizado: ' + root);
