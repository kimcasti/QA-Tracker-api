import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the real pure normalizer without importing Strapi or its bootstrap.
const source = readFileSync(join(__dirname, 'sprint.ts'), 'utf8');
const ast = ts.createSourceFile('sprint.ts', source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(
  statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'normalizeSprintData',
);
assert.ok(declaration, 'the sprint controller normalizer must exist');
const compiled = ts.transpileModule(declaration.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const normalize = runInNewContext(`${compiled}\nnormalizeSprintData;`);

test('the sprint controller omits missing dates instead of passing invalid empty dates to Strapi', () => {
  for (const dates of [{}, { startDate: '', endDate: '' }]) {
    const data = normalize({ name: 'Imported sprint', ...dates });
    assert.equal(Object.hasOwn(data, 'startDate'), false, 'missing startDate must remain omitted');
    assert.equal(Object.hasOwn(data, 'endDate'), false, 'missing endDate must remain omitted');
    assert.equal(data.name, 'Imported sprint');
    assert.equal(data.status, 'planned');
  }
});

test('the sprint controller preserves supplied dates independently', () => {
  const data = normalize({ startDate: '2026-10-01', endDate: '2026-10-14' });
  assert.equal(data.startDate, '2026-10-01');
  assert.equal(data.endDate, '2026-10-14');
  const startOnly = normalize({ startDate: '2026-10-01' });
  assert.equal(startOnly.startDate, '2026-10-01');
  assert.equal(Object.hasOwn(startOnly, 'endDate'), false);
});
