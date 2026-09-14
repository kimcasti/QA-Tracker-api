import assert from 'node:assert/strict';
import { test } from 'node:test';
import controller from './jira-integration';

test('disabled creation rejects before database access or any external request', async () => {
  const previous = process.env.JIRA_ENABLE_WRITES;
  delete process.env.JIRA_ENABLE_WRITES;
  try { await assert.rejects(controller.createIssue({}), /deshabilitado/); }
  finally { if (previous === undefined) delete process.env.JIRA_ENABLE_WRITES; else process.env.JIRA_ENABLE_WRITES = previous; }
});

test('title-only creation saves link once; attachment failure and retry never duplicate a ticket', async () => {
  const previousEnv = { ...process.env };
  const originalFetch = global.fetch;
  const originalStrapi = (global as any).strapi;
  const externalCalls: string[] = [];
  const saved: any[] = [];
  let record: any;
  const project = { documentId: 'project', organization: { documentId: 'org' }, jiraIntegration: { site: 'https://example.atlassian.net', userId: 2, projectId: '100', issueTypeId: '200' } };
  (global as any).strapi = {
    documents: (uid: string) => ({
      findFirst: async () => uid.includes('test-run-result') ? { documentId: 'result' } : project,
      findMany: async () => [{ isActive: true, organization: { documentId: 'org', status: 'active' }, organizationRole: { code: 'owner' } }],
      update: async value => { saved.push(value); return value; },
    }),
    db: { query: (uid: string) => uid.includes('jira-account') || uid.includes('jira-oauth') ? { findOne: async () => null } : uid.includes('jira-connection') ? { findOne: async () => ({ destination: project.jiraIntegration }) } : ({
      findOne: async () => record,
      create: async ({ data }) => { if (record) throw new Error('duplicate'); record = { id: 1, ...data }; return record; },
      update: async ({ data }) => { record = { ...record, ...data }; return record; },
    }) },
  };
  Object.assign(process.env, { JIRA_ENABLE_WRITES: 'true', JIRA_SITE_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'fake@example.com', JIRA_API_TOKEN: 'fake', JIRA_QA_USER_ID: '2' });
  delete process.env.JIRA_CLOUD_ID;
  global.fetch = (async (url, options) => {
    externalCalls.push(String(url));
    if (String(url).endsWith('/attachments')) return new Response('{}', { status: 403 });
    const body = JSON.parse(String(options.body));
    assert.equal(body.fields.summary, 'Prueba controlada');
    assert.deepEqual(body.fields.project, { id: '100' });
    assert.deepEqual(body.fields.issuetype, { id: '200' });
    assert.equal(body.fields.description, undefined);
    return new Response(JSON.stringify({ key: 'LPAS-123' }), { status: 201 });
  }) as typeof fetch;
  const ctx: any = { state: { user: { id: 2 } }, params: { projectKey: 'LPAS' }, request: { body: { data: { title: 'Prueba controlada', testRunId: 'run', testCaseId: 'case', evidenceImage: 'data:image/png;base64,aGVsbG8=' } } } };
  try {
    await controller.createIssue(ctx);
    assert.equal(ctx.body.data.key, 'LPAS-123');
    assert.match(ctx.body.data.warning, /captura/);
    assert.equal(saved[0].data.bugLink, 'https://example.atlassian.net/browse/LPAS-123');
    await controller.createIssue(ctx);
    assert.equal(externalCalls.filter(url => url.endsWith('/issue')).length, 1);
    assert.equal(externalCalls.length, 2);
    assert.equal(record.state, 'created');
    record = undefined;
    let uncertainCalls = 0;
    global.fetch = (async () => { uncertainCalls++; throw new Error('Connection lost after request'); }) as typeof fetch;
    await assert.rejects(controller.createIssue(ctx), /No se pudo confirmar/);
    assert.equal(record.state, 'uncertain');
    await assert.rejects(controller.createIssue(ctx), /incierto/);
    assert.equal(uncertainCalls, 1);
  } finally {
    global.fetch = originalFetch;
    (global as any).strapi = originalStrapi;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
});
