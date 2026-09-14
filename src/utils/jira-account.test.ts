import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encryptToken, decryptToken, resolveJiraCredentials, accountStatus, validateAndSaveAccount, disconnectAccount } from './jira-account';

const key = Buffer.alloc(32, 7).toString('base64');
test('authenticated encryption rejects another user, changed ciphertext and missing keys', () => {
  const env = { JIRA_CREDENTIALS_ENCRYPTION_KEY: key };
  const encrypted = encryptToken('secret-api-token', 2, env);
  assert.equal(encrypted.includes('secret-api-token'), false);
  assert.equal(decryptToken(encrypted, 2, env), 'secret-api-token');
  assert.notEqual(encrypted, encryptToken('secret-api-token', 2, env));
  assert.throws(() => decryptToken(encrypted, 3, env), /No se pudo leer/);
  const parts = encrypted.split('.'); parts[2] = Buffer.alloc(16).toString('base64');
  assert.throws(() => decryptToken(parts.join('.'), 2, env), /No se pudo leer/);
  assert.throws(() => encryptToken('secret', 2, {}), /clave de cifrado/);
});

test('validates with GET only, isolates users, keeps old token on failure, and disconnect prevents legacy fallback', async () => {
  const previousEnv = { ...process.env };
  const originalFetch = global.fetch;
  const originalStrapi = (globalThis as any).strapi;
  const rows = new Map<number, any>();
  let reject = false;
  const calls: string[] = [];
  Object.assign(process.env, { JIRA_CREDENTIALS_ENCRYPTION_KEY: key, JIRA_SITE_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'legacy@example.com', JIRA_API_TOKEN: 'legacy-secret', JIRA_QA_USER_ID: '2' });
  delete process.env.JIRA_CLOUD_ID;
  (globalThis as any).strapi = { db: { transaction: async run => run(), query: (uid: string) => uid.includes('jira-oauth') ? { findOne: async () => null, create: async () => ({}), deleteMany: async () => ({ count: 0 }) } : ({
    findOne: async ({ where }) => rows.get(where.userId) || null,
    create: async ({ data }) => { assert.ok(!rows.has(data.userId)); const row = { id: data.userId, ...data }; rows.set(data.userId, row); return row; },
    update: async ({ where, data }) => { assert.equal(where.userId, data.userId); const row = { id: where.id, ...data }; rows.set(data.userId, row); return row; },
    updateMany: async () => ({ count: 0 }),
  }) } };
  global.fetch = (async (url, options) => {
    assert.equal(options?.method || 'GET', 'GET');
    calls.push(String(url));
    return new Response(JSON.stringify(reject ? { leak: 'upstream-secret' } : String(url).endsWith('serverInfo') ? { baseUrl: 'https://different.atlassian.net' } : { accountId: 'account', active: true, displayName: 'Test User' }), { status: reject ? 401 : 200 });
  }) as typeof fetch;
  try {
    assert.equal(await resolveJiraCredentials(3), null);
    assert.equal((await resolveJiraCredentials(2))?.token, 'legacy-secret');
    const draft = { site: 'https://example.atlassian.net', email: 'test@example.com', token: 'new-secret-token' };
    const status = await validateAndSaveAccount(2, draft);
    assert.equal(status.source, 'saved');
    assert.equal(status.accountName, 'Test User');
    assert.ok(!JSON.stringify(status).includes('new-secret-token'));
    assert.ok(!JSON.stringify(rows.get(2)).includes('new-secret-token'));
    assert.equal((await resolveJiraCredentials(2))?.token, draft.token);
    assert.equal((await accountStatus(3)).connected, false);
    reject = true;
    await assert.rejects(validateAndSaveAccount(2, { ...draft, token: 'rejected-secret' }), error => !String(error).includes('upstream-secret'));
    assert.equal((await resolveJiraCredentials(2))?.token, draft.token);
    reject = false;
    await assert.rejects(validateAndSaveAccount(2, { ...draft, cloudId: 'different-cloud' }), /no corresponde/);
    assert.equal((await resolveJiraCredentials(2))?.token, draft.token);
    await assert.rejects(validateAndSaveAccount(2, { ...draft, site: 'https://evil.example' }));
    await disconnectAccount(2);
    assert.equal(rows.get(2).encryptedToken, null);
    assert.equal(await resolveJiraCredentials(2), null);
    assert.equal((await accountStatus(2)).connected, false);
    assert.ok(calls.every(url => /\/(myself|serverInfo)$/.test(url)));
  } finally {
    global.fetch = originalFetch; (globalThis as any).strapi = originalStrapi;
    for (const name of Object.keys(process.env)) if (!(name in previousEnv)) delete process.env[name];
    Object.assign(process.env, previousEnv);
  }
});
