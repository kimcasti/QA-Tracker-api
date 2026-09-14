import { encryptionKey, encryptToken, decryptToken } from './jira-crypto';
export { encryptionKey, encryptToken, decryptToken } from './jira-crypto';
import { errors } from '@strapi/utils';
import { jiraClient, jiraCredentials, type JiraCredentials } from './jira';
import { disconnectOAuth, oauthAccountUid, oauthStatus, resolveOAuthCredentials } from './jira-oauth';

export const jiraAccountUid = 'api::jira-account.jira-account' as const;
const repository = () => strapi.db.query(jiraAccountUid as any);

export async function resolveJiraCredentials(userId: number): Promise<JiraCredentials | null> {
  const oauth = await resolveOAuthCredentials(userId);
  if (oauth !== undefined) return oauth;
  const row = await repository().findOne({ where: { userId } });
  // A disconnected row deliberately prevents fallback to the old environment token.
  if (row) {
    if (!row.enabled) return null;
    return jiraCredentials({ JIRA_SITE_URL: row.site, JIRA_EMAIL: row.email, JIRA_API_TOKEN: decryptToken(row.encryptedToken, userId), JIRA_QA_USER_ID: String(userId), JIRA_CLOUD_ID: row.cloudId || '' });
  }
  if (Number(process.env.JIRA_QA_USER_ID) !== userId) return null;
  return jiraCredentials();
}

export async function accountStatus(userId: number) {
  const row = await repository().findOne({ where: { userId } });
  let canStore = true;
  try { encryptionKey(); } catch { canStore = false; }
  const oauth = await oauthStatus(userId);
  if (oauth.state && oauth.state !== 'legacy') return { connected: oauth.connected, source: 'oauth', site: oauth.site, email: null, cloudId: null, accountName: oauth.accountName, validatedAt: null, canStore };
  if (row) return { connected: Boolean(row.enabled), source: row.enabled ? 'saved' : null, site: row.enabled ? row.site : null, email: row.enabled ? row.email : null, cloudId: row.enabled ? row.cloudId : null, accountName: row.enabled ? row.accountName : null, validatedAt: row.enabled ? row.validatedAt : null, canStore };
  const legacy = Number(process.env.JIRA_QA_USER_ID) === userId ? jiraCredentials() : null;
  return { connected: Boolean(legacy), source: legacy ? 'environment' : null, site: legacy?.site || null, email: legacy?.email || null, cloudId: legacy ? process.env.JIRA_CLOUD_ID || null : null, accountName: null, validatedAt: null, canStore };
}

export function validateDraft(userId: number, input: Record<string, unknown>) {
  const site = typeof input.site === 'string' ? input.site.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  const cloudId = typeof input.cloudId === 'string' ? input.cloudId.trim() : '';
  if (!site || site.length > 255 || !/^[^\s:@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !token || token.length > 8192 || /\s/.test(token) || cloudId.length > 100) {
    throw new errors.ValidationError('Completa una URL de Jira, un correo y un token de API válidos.');
  }
  const credentials = jiraCredentials({ JIRA_SITE_URL: site, JIRA_EMAIL: email, JIRA_API_TOKEN: token, JIRA_QA_USER_ID: String(userId), JIRA_CLOUD_ID: cloudId })!;
  return { credentials, cloudId };
}

export async function validateAndSaveAccount(userId: number, input: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') throw new errors.ValidationError('En producción conecta tu cuenta mediante OAuth.');
  const oauth = await strapi.db.query(oauthAccountUid as any).findOne({ where: { userId } });
  if (oauth && oauth.state !== 'legacy') throw new errors.ValidationError('Esta cuenta utiliza OAuth. Usa Conectar con Jira para reemplazarla.');
  encryptionKey(); // Fail before sending credentials if storage is unavailable.
  const { credentials, cloudId } = validateDraft(userId, input);
  const client = jiraClient(credentials);
  if (cloudId) {
    const server = await client('/rest/api/3/serverInfo');
    if (!server.baseUrl || new URL(server.baseUrl).origin !== credentials.site) throw new errors.ValidationError('El Cloud ID no corresponde al sitio de Jira indicado.');
  }
  const account = await client('/rest/api/3/myself');
  if (!account.accountId || account.active === false) throw new errors.ValidationError('La cuenta de Jira no está disponible.');
  const data = { userId, enabled: true, site: credentials.site, email: credentials.email, cloudId: cloudId || null,
    encryptedToken: encryptToken(credentials.token, userId), accountName: String(account.displayName || credentials.email).slice(0, 255), validatedAt: new Date().toISOString() };
  const existing = await repository().findOne({ where: { userId } });
  if (existing) await repository().update({ where: { id: existing.id, userId }, data });
  else await repository().create({ data });
  return accountStatus(userId);
}

export async function disconnectAccount(userId: number) {
  await disconnectOAuth(userId);
  const existing = await repository().findOne({ where: { userId } });
  const data = { userId, enabled: false, encryptedToken: null, site: null, email: null, cloudId: null, accountName: null, validatedAt: null };
  if (existing) await repository().update({ where: { id: existing.id, userId }, data });
  else await repository().create({ data });
  return { disconnected: true };
}
