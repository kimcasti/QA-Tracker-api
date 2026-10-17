import { readdirSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folders = ['src'];
function collect(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? collect(path) : entry.name.endsWith('.test.ts') ? [relative(root, path)] : [];
  });
}
// Expand paths ourselves: Node 20 does not expand a quoted ** glob.
// Only isolated TypeScript unit tests; never include E2E/browser/server runners.
const files = folders.flatMap(folder => collect(join(root, folder))).sort();
if (!files.length) throw new Error('No unit tests found.');
const preload = join(root, 'scripts', 'unit-test-no-network.cjs').replaceAll('\\', '/');
const nodeOptions = [process.env.NODE_OPTIONS, `--require="${preload}"`].filter(Boolean).join(' ');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...process.argv.slice(2), ...files], {
  cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
