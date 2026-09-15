import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startOAuth, completeOAuth, selectOAuthSite, resolveOAuthCredentials, disconnectOAuth, oauthStatus, oauthConfig, oauthAccountUid, oauthSessionUid, jiraScopes } from './jira-oauth';
import { decryptToken, encryptToken } from './jira-crypto';
import { jiraClient } from './jira';
import { runJiraPersonalDataReport } from './jira-personal-data-report';

const settings = { NODE_ENV: 'test', JIRA_OAUTH_CLIENT_ID: 'test-client', JIRA_OAUTH_CLIENT_SECRET: 'test-client-secret', JIRA_OAUTH_REDIRECT_URI: 'http://localhost:3000/settings/integrations/jira/callback', JIRA_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') };
const sites = [{ id: 'cloud-1', name: 'Test Jira', url: 'https://example.atlassian.net', scopes: jiraScopes }];
const tokenResponse = (suffix = '1') => ({ access_token: `access-secret-${suffix}`, refresh_token: `refresh-secret-${suffix}`, expires_in: 3600, token_type: 'Bearer' });

function matches(row: any, where: any): boolean {
  return Object.entries(where || {}).every(([key, value]: [string, any]) => {
    if (key === '$or') return value.some(item => matches(row, item));
    if (value && typeof value === 'object') return Object.entries(value).every(([op, expected]: [string, any]) => op === '$null' ? row[key] == null : op === '$gt' ? row[key] > expected : op === '$lt' ? row[key] < expected : false);
    return row[key] === value;
  });
}
async function fixture(run: (context: { tables: Map<string, any[]>; calls: string[]; setFetch: (fn: typeof fetch) => void }) => Promise<void>) {
  const previousEnv = { ...process.env }, originalFetch = global.fetch, originalStrapi = (globalThis as any).strapi;
  Object.assign(process.env, settings);
  let tables = new Map<string, any[]>([[oauthAccountUid, []], [oauthSessionUid, []], ['api::jira-account.jira-account', []]]);
  const calls: string[] = [];
  let sequence = 0;
  (globalThis as any).strapi = { db: {
    transaction: async run => { const snapshot = structuredClone(tables); try { return await run(); } catch (error) { tables.clear(); for (const [key, rows] of snapshot) tables.set(key, rows); throw error; } },
    query: uid => ({
      findOne: async ({ where }) => structuredClone(tables.get(uid)!.find(row => matches(row, where)) || null),
      findMany: async ({ where } = {}) => structuredClone(tables.get(uid)!.filter(row => matches(row, where))),
      create: async ({ data }) => { const row = { id: ++sequence, ...data }; tables.get(uid)!.push(row); return structuredClone(row); },
      update: async ({ where, data }) => { const row = tables.get(uid)!.find(row => matches(row, where)); Object.assign(row, data); return structuredClone(row); },
      updateMany: async ({ where, data }) => { const rows = tables.get(uid)!.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
      deleteMany: async ({ where }) => { const rows = tables.get(uid)!; const kept = rows.filter(row => !matches(row, where)); tables.set(uid, kept); return { count: rows.length - kept.length }; },
    }),
  } };
  let responder: typeof fetch = (async (url, options) => {
    if (String(url).endsWith('/oauth/token')) { assert.equal(options.method, 'POST'); return Response.json(tokenResponse()); }
    assert.equal(options.method || 'GET', 'GET');
    if (String(url).endsWith('/accessible-resources')) return Response.json(sites);
    if (String(url).endsWith('/myself')) return Response.json({ accountId: 'account-1', displayName: 'Example User', active: true });
    assert.fail(`Unexpected external call: ${new URL(String(url)).pathname}`);
  }) as typeof fetch;
  global.fetch = (async (url, options) => { calls.push(String(url)); assert.equal(options.redirect, 'error'); return responder(url, options); }) as typeof fetch;
  try { await run({ tables, calls, setFetch: fn => { responder = fn; } }); }
  finally { global.fetch = originalFetch; (globalThis as any).strapi = originalStrapi; for (const name of Object.keys(process.env)) if (!(name in previousEnv)) delete process.env[name]; Object.assign(process.env, previousEnv); }
}
async function connected() {
  const { authorizationUrl } = await startOAuth(2);
  const state = new URL(authorizationUrl).searchParams.get('state')!;
  const ready = await completeOAuth(2, { state, code: 'one-use-code' });
  await selectOAuthSite(2, ready.selectionId, 'cloud-1');
}
function expire(row: any) { const grant = JSON.parse(decryptToken(row.encryptedGrant, 2)); grant.expiresAt = Date.now() - 1000; row.encryptedGrant = encryptToken(JSON.stringify(grant), 2); }

test('OAuth config requires a fixed callback, HTTPS in production and server secrets', () => {
  assert.throws(() => oauthConfig({}), /configurar/);
  assert.equal(oauthConfig(settings).clientId, 'test-client');
  assert.throws(() => oauthConfig({ ...settings, NODE_ENV: 'production' }), /regreso/);
  assert.throws(() => oauthConfig({ ...settings, JIRA_OAUTH_REDIRECT_URI: 'https://example.com/callback?next=evil' }), /regreso/);
});

test('state is user-bound, expires, single-use; site selection cannot forge the destination', async () => fixture(async ({ tables, calls }) => {
  const { authorizationUrl } = await startOAuth(2);
  const url = new URL(authorizationUrl), state = url.searchParams.get('state')!;
  assert.equal(url.origin, 'https://auth.atlassian.com'); assert.ok(url.searchParams.get('scope')!.includes('offline_access'));
  assert.equal(authorizationUrl.includes(settings.JIRA_OAUTH_CLIENT_SECRET), false);
  assert.equal(JSON.stringify(tables.get(oauthSessionUid)).includes(state), false);
  await assert.rejects(completeOAuth(3, { state, code: 'code' }), /otra cuenta/); assert.equal(calls.length, 0);
  const ready = await completeOAuth(2, { state, code: 'code' });
  await assert.rejects(completeOAuth(2, { state, code: 'code' }), /ya se utilizó/);
  await assert.rejects(selectOAuthSite(3, ready.selectionId, 'cloud-1'));
  await assert.rejects(selectOAuthSite(2, ready.selectionId, 'forged-site'));
  await selectOAuthSite(2, ready.selectionId, 'cloud-1');
  await assert.rejects(selectOAuthSite(2, ready.selectionId, 'cloud-1'));
  const row = tables.get(oauthAccountUid)![0]; assert.equal(row.site, sites[0].url); assert.equal(row.encryptedGrant.includes('access-secret'), false);
  const status = await oauthStatus(2); assert.equal(status.connected, true); assert.equal(JSON.stringify(status).includes('secret'), false);
  const creds = await resolveOAuthCredentials(2); assert.equal(creds!.authType, 'bearer');
  const headerCalls: string[] = [];
  await jiraClient(creds!, (async (_url, options) => { headerCalls.push((options.headers as any).Authorization); return Response.json({}); }) as typeof fetch)('/rest/api/3/myself');
  assert.deepEqual(headerCalls, ['Bearer access-secret-1']);
  assert.equal(await resolveOAuthCredentials(3), undefined);
  const next = await startOAuth(2); tables.get(oauthSessionUid)![0].expiresAt = '2000-01-01';
  await assert.rejects(completeOAuth(2, { state: new URL(next.authorizationUrl).searchParams.get('state')!, code: 'code' }));
  assert.equal((await oauthStatus(2)).connected, true);
}));

test('denial and disconnect invalidate pending authorization without creating issues', async () => fixture(async ({ tables, calls }) => {
  await connected();
  const next = await startOAuth(2); const state = new URL(next.authorizationUrl).searchParams.get('state')!;
  const before = calls.length; await assert.rejects(completeOAuth(2, { state, error: 'access_denied' }), /No se autorizó/);
  assert.equal(calls.length, before); assert.equal((await oauthStatus(2)).connected, true);
  const third = await startOAuth(2); await disconnectOAuth(2);
  await assert.rejects(completeOAuth(2, { state: new URL(third.authorizationUrl).searchParams.get('state')!, code: 'code' }));
  assert.equal(await resolveOAuthCredentials(2), null); assert.equal(tables.get(oauthAccountUid)![0].encryptedGrant, null);
  assert.ok(calls.every(url => !url.endsWith('/issue') && !url.endsWith('/attachments')));
}));

test('refresh rotates tokens once, blocks concurrent refresh, and never resurrects a disconnected account', async () => fixture(async ({ tables, setFetch }) => {
  await connected(); const row = tables.get(oauthAccountUid)![0]; expire(row);
  let release!: () => void; let started!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; }); let refreshes = 0;
  setFetch((async (url, options) => {
    if (String(url).endsWith('/oauth/token')) { refreshes++; assert.equal(JSON.parse(String(options.body)).refresh_token, 'refresh-secret-1'); started(); await gate; return Response.json(tokenResponse('2')); }
    return Response.json(sites);
  }) as typeof fetch);
  const first = resolveOAuthCredentials(2); await began;
  await assert.rejects(resolveOAuthCredentials(2), /renovando/); release();
  assert.equal((await first)!.token, 'access-secret-2'); assert.equal(refreshes, 1);
  assert.equal(JSON.parse(decryptToken(row.encryptedGrant, 2)).refreshToken, 'refresh-secret-2');
  expire(row);
  setFetch((async () => { await disconnectOAuth(2); return Response.json(tokenResponse('3')); }) as typeof fetch);
  await assert.rejects(resolveOAuthCredentials(2), /Reconecta/);
  assert.equal(await resolveOAuthCredentials(2), null); assert.equal(row.encryptedGrant, null);
}));

test('revoked access and uncertain refresh require reconnection without replaying Jira writes', async () => fixture(async ({ tables, setFetch }) => {
  await connected(); const row = tables.get(oauthAccountUid)![0];
  const creds = await resolveOAuthCredentials(2);
  let requests = 0;
  await assert.rejects(jiraClient(creds!, (async () => { requests++; return new Response('{}', { status: 401 }); }) as typeof fetch)('/rest/api/3/myself'));
  assert.equal(requests, 1); assert.equal((await oauthStatus(2)).reconnect, true);
  assert.equal(row.encryptedGrant, null);
  await connected(); const current = tables.get(oauthAccountUid)![0]; expire(current);
  setFetch((async () => { throw new Error('private upstream details'); }) as typeof fetch);
  await assert.rejects(resolveOAuthCredentials(2), /Reconecta/);
  assert.equal(current.state, 'reconnect'); assert.equal(current.encryptedGrant, null);
}));

test('privacy reporting erases a closed Jira account and its credentials', async () => fixture(async ({ tables, setFetch }) => {
  Object.assign(process.env, {
    JIRA_PRIVACY_REPORTING_ENABLED: 'true',
    JIRA_PRIVACY_REPORTER_USER_ID: '2',
  });
  await connected();
  const account = tables.get(oauthAccountUid)![0];
  setFetch((async (url, options) => {
    assert.equal(String(url), 'https://api.atlassian.com/app/report-accounts/');
    assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer access-secret-1');
    const payload = JSON.parse(String(options.body));
    assert.equal(payload.accounts[0].accountId, 'account-1');
    return Response.json(
      { accounts: [{ accountId: 'account-1', status: 'closed' }] },
      { headers: { 'Cycle-Period': 'P7D' } },
    );
  }) as typeof fetch);

  const summary = await runJiraPersonalDataReport({ strapi: (globalThis as any).strapi });

  assert.deepEqual(summary, { enabled: true, reported: 0, disconnected: 1, refreshed: 0 });
  assert.equal(account.state, 'disconnected');
  assert.equal(account.encryptedGrant, null);
  assert.equal(account.accountId, null);
  assert.equal(account.accountName, null);
}));

test('privacy reporting refreshes updated Jira profile data and observes the report cycle', async () => fixture(async ({ tables, setFetch }) => {
  Object.assign(process.env, {
    JIRA_PRIVACY_REPORTING_ENABLED: 'true',
    JIRA_PRIVACY_REPORTER_USER_ID: '2',
  });
  await connected();
  const account = tables.get(oauthAccountUid)![0];
  setFetch((async (url, options) => {
    if (String(url) === 'https://api.atlassian.com/app/report-accounts/') {
      assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer access-secret-1');
      return Response.json(
        { accounts: [{ accountId: 'account-1', status: 'updated' }] },
        { headers: { 'Cycle-Period': 'P7D' } },
      );
    }
    if (String(url).endsWith('/myself')) {
      return Response.json({ accountId: 'account-1', displayName: 'Updated User', active: true });
    }
    assert.fail(`Unexpected external call: ${String(url)}`);
  }) as typeof fetch);
  const now = new Date('2026-09-15T12:00:00.000Z');

  const summary = await runJiraPersonalDataReport({ strapi: (globalThis as any).strapi, now });

  assert.deepEqual(summary, { enabled: true, reported: 1, disconnected: 0, refreshed: 1 });
  assert.equal(account.accountName, 'Updated User');
  assert.equal(account.privacyReportDueAt, '2026-09-22T12:00:00.000Z');
}));
