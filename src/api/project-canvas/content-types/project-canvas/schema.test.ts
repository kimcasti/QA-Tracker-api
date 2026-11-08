import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

// Exercise the installed Strapi pipeline without starting Strapi or opening a DB.
// These internal pure helpers are intentionally resolved from the installed packages
// so an upgrade must still generate and retain a physical unique index.
const require = createRequire(import.meta.url);
const coreDist = dirname(require.resolve('@strapi/core'));
const databaseDist = dirname(require.resolve('@strapi/database'));
const { createContentType } = require(join(coreDist, 'domain/content-type/index.js'));
const { transformContentTypesToModels } = require(join(coreDist, 'utils/transform-content-types-to-models.js'));
const { Metadata } = require(join(databaseDist, 'metadata/metadata.js'));
const { metadataToSchema } = require(join(databaseDist, 'schema/schema.js'));
const createSchemaDiff = require(join(databaseDist, 'schema/diff.js'));
const MysqlDialect = require(join(databaseDist, 'dialects/mysql/index.js'));
const uid = 'api::project-canvas.project-canvas';
const expectedIndex = {
  name: 'project_canvases_project_key_unique',
  columns: ['project_key'],
  type: 'unique',
};

function canvasDatabaseSchema() {
  const schema = JSON.parse(readFileSync(resolve('src/api/project-canvas/content-types/project-canvas/schema.json'), 'utf8'));
  const previousStrapi = (globalThis as any).strapi;
  let contentType: any;
  try {
    // Content-type construction reads only this feature flag from Strapi.
    (globalThis as any).strapi = { config: { get: (_key: string, fallback: unknown) => fallback } };
    contentType = createContentType(uid, { schema });
  } finally {
    if (previousStrapi === undefined) delete (globalThis as any).strapi;
    else (globalThis as any).strapi = previousStrapi;
  }
  const metadata = new Metadata();
  const models = transformContentTypesToModels([contentType], metadata.identifiers);
  // Only the relation targets are fixtures; Canvas uses its complete real schema,
  // including Strapi's creator relations, timestamps and document index.
  metadata.loadModels([
    ...models,
    ...[
      ['api::project.project', 'projects'],
      ['api::organization.organization', 'organizations'],
      ['admin::user', 'admin_users'],
    ].map(([targetUid, tableName]) => ({
      uid: targetUid,
      singularName: tableName,
      tableName,
      attributes: { id: { type: 'increments' } },
    })),
  ]);
  return metadataToSchema(metadata);
}

test('Canvas generates a SQL unique project_key index that schema synchronization adds and retains', async () => {
  const userSchema = canvasDatabaseSchema();
  const table = userSchema.tables.find((entry: any) => entry.name === 'project_canvases');
  assert.ok(table);
  assert.ok(table.columns.some((column: any) => column.name === 'project_key'));
  assert.deepEqual(table.indexes.filter((index: any) => index.type === 'unique' && index.columns.includes('project_key')), [expectedIndex],
    'unique:true alone is document validation, not a physical unique index');

  // Simulate the observed pre-fix schema, then the next startup after applying
  // the index. The real differ must add it once and never schedule its removal.
  const previousSchema = structuredClone(userSchema);
  previousSchema.tables.find((entry: any) => entry.name === table.name).indexes = table.indexes.filter((index: any) => index.name !== expectedIndex.name);
  const differ = createSchemaDiff({ dialect: new MysqlDialect({}) });
  const firstSync = await differ.diff({ previousSchema, databaseSchema: previousSchema, userSchema });
  const change = firstSync.diff.tables.updated.find((entry: any) => entry.name === table.name);
  assert.ok(change, 'Existing Canvas table must be synchronized');
  assert.deepEqual(change.indexes.added, [expectedIndex]);
  assert.deepEqual(change.indexes.removed, []);

  const nextSync = await differ.diff({ previousSchema: structuredClone(userSchema), databaseSchema: structuredClone(userSchema), userSchema: canvasDatabaseSchema() });
  assert.equal(nextSync.status, 'UNCHANGED');
  assert.deepEqual(nextSync.diff.tables.updated, []);
  assert.deepEqual(nextSync.diff.tables.removed, []);
});
