// Integration check on a newly created, disposable local MySQL database.
// Never uses or writes to the configured application's database.
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');

async function main() {
  assert.ok(['localhost', '127.0.0.1'].includes(process.env.DATABASE_HOST), 'This check requires a local MySQL host.');
  const name = 'qa_catalog_test_' + crypto.randomBytes(6).toString('hex');
  const connection = await mysql.createConnection({ host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 3306), user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD });
  let app;
  try {
    await connection.query('CREATE DATABASE ??', [name]);
    Object.assign(process.env, { DATABASE_NAME: name, DATABASE_CLIENT: 'mysql', STRAPI_TELEMETRY_DISABLED: 'true',
      INITIAL_ORGANIZATION_SLUG: 'catalog-integration', INITIAL_ORGANIZATION_NAME: 'Catalog integration',
      INITIAL_USER_EMAIL: 'catalog-integration@qa.local', INITIAL_USER_USERNAME: 'catalog-integration',
      INITIAL_USER_PASSWORD: crypto.randomBytes(24).toString('hex'), INITIAL_USER_IS_SUPERADMIN: 'false',
      SMTP_HOST: '', NODE_ENV: 'test' });
    const { createStrapi } = require('@strapi/strapi');
    app = await createStrapi({ appDir: path.resolve(__dirname, '..'), distDir: path.resolve(__dirname, '../dist') }).load();
    const org = await app.documents('api::organization.organization').findFirst({ filters: { slug: 'catalog-integration' } });
    const user = await app.db.query('plugin::users-permissions.user').findOne({ where: { email: 'catalog-integration@qa.local' } });
    const project = await app.documents('api::project.project').create({ data: { name: 'Catalog validation', key: 'CATALOG-TEST', organization: org.documentId } });
    const module = await app.documents('api::project-module.project-module').create({ data: { name: 'Auth', project: project.documentId, organization: org.documentId } });
    const functionality = await app.documents('api::functionality.functionality').create({ data: {
      code: 'AUTH-1', name: 'Acceso', module: module.documentId, project: project.documentId, organization: org.documentId,
    } });
    const caseData = { title: 'Iniciar sesión', description: 'Preserved description', automationReference: 'old::login',
      automationStatus: 'not_automated', automationTool: 'cypress', project: project.documentId,
      functionality: functionality.documentId, organization: org.documentId, sortOrder: 7 };
    const item = await app.documents('api::test-case.test-case').create({ data: caseData });
    const connectionRow = await app.db.query('api::automation-connection.automation-connection').create({ data: {
      tokenHash: crypto.randomBytes(32).toString('hex'), label: 'Integration', state: 'active', userId: user.id,
      projectId: project.documentId, projectKey: project.key, expiresAt: '2099-01-01T00:00:00.000Z',
    } });
    const runner = require('../dist/src/api/automation-runner/services/automation-runner').default;
    const catalog = require('../dist/src/api/automation-catalog/services/automation-catalog').default;
    const ctx = data => ({ state: { user, automationConnection: connectionRow }, params: { projectKey: project.key, requestId: '1' }, request: { body: { data } } });
    const registered = await runner.register(ctx({ session: 'integration', catalog: [], catalogRefreshVersion: 1, environments: ['local'] }));
    const request = await catalog.request(ctx({ runnerId: registered.id, environment: 'local', requestId: 'integration' }));
    const queryCtx = data => ({ ...ctx(data), params: { projectKey: project.key, requestId: String(request.id) } });
    const poll = await runner.poll(ctx({ session: 'integration', claim: true }));
    assert.equal(poll.catalogRequest.id, request.id);
    await runner.completeCatalog(ctx({ session: 'integration', catalogRequestId: request.id, references: ['auth.spec.ts::Iniciar sesión'] }));
    const details = await catalog.details(queryCtx({}));
    assert.equal(details.cases.length, 1);
    assert.equal(details.cases[0].module, 'Auth');
    const assignment = { requestId: 'save', catalogHash: details.catalogHash,
      assignments: [{ caseId: item.documentId, reference: details.references[0], snapshot: details.cases[0].snapshot }] };
    await catalog.assign(queryCtx(assignment));
    await catalog.assign(queryCtx(assignment));
    const updated = await app.documents('api::test-case.test-case').findOne({ documentId: item.documentId });
    assert.equal(updated.automationStatus, 'automated');
    assert.equal(updated.automationReference, 'auth.spec.ts::Iniciar sesión');
    assert.equal(updated.description, caseData.description);
    assert.equal(updated.sortOrder, 7);
    assert.equal(updated.lastAutomationStatus, 'unknown');
    assert.equal(updated.lastAutomationRunAt, null);
    assert.equal(updated.automationType, 'ui');
    const second = await app.documents('api::test-case.test-case').create({ data: { ...caseData, title: 'Cerrar sesión', automationReference: '' } });
    const next = await catalog.request(ctx({ runnerId: registered.id, environment: 'local', requestId: 'second' }));
    const nextCtx = data => ({ ...ctx(data), params: { projectKey: project.key, requestId: String(next.id) } });
    await runner.poll(ctx({ session: 'integration', claim: true }));
    await runner.completeCatalog(ctx({ session: 'integration', catalogRequestId: next.id, references: ['new::Login', 'new::Logout'] }));
    const fresh = await catalog.details(nextCtx({}));
    let failSecond = true;
    app.documents.use(async (context, proceed) => {
      if (failSecond && context.uid === 'api::test-case.test-case' && context.action === 'update' && context.params.documentId === second.documentId) throw Error('Injected second-write failure');
      return proceed();
    });
    const batch = { requestId: 'rollback', catalogHash: fresh.catalogHash, assignments: [
      { caseId: item.documentId, reference: 'new::Login', snapshot: fresh.cases.find(row => row.id === item.documentId).snapshot },
      { caseId: second.documentId, reference: 'new::Logout', snapshot: fresh.cases.find(row => row.id === second.documentId).snapshot },
    ] };
    await assert.rejects(catalog.assign(nextCtx(batch)), /second-write/);
    assert.equal((await app.documents('api::test-case.test-case').findOne({ documentId: item.documentId })).automationReference, 'auth.spec.ts::Iniciar sesión');
    assert.equal((await app.documents('api::test-case.test-case').findOne({ documentId: second.documentId })).automationReference, '');
    failSecond = false;
    const concurrent = await Promise.allSettled(['new::Login', 'new::Logout'].map((reference, i) => catalog.assign(nextCtx({
      requestId: 'concurrent-' + i, catalogHash: fresh.catalogHash,
      assignments: [{ ...batch.assignments[0], reference }],
    }))));
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter(result => result.status === 'rejected').length, 1);
    console.log('MySQL integration passed: schema, project locks, discovery, assignment, retries, rollback and concurrent edits.');
    // Strapi emits document events after commit; drain them before destroying its global context.
    await new Promise(resolve => setTimeout(resolve, 500));
  } finally {
    if (app) await app.destroy();
    // Generated name is validated before dropping this disposable database.
    assert.match(name, /^qa_catalog_test_[a-f0-9]{12}$/);
    await connection.query('DROP DATABASE IF EXISTS ??', [name]);
    await connection.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
