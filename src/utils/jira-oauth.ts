import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { errors } from '@strapi/utils';
import { decryptToken, encryptToken, encryptionKey } from './jira-crypto';
import { jiraClient, type JiraCredentials } from './jira';

export const oauthAccountUid = 'api::jira-oauth-account.jira-oauth-account';
export const oauthSessionUid = 'api::jira-oauth-session.jira-oauth-session';
const accounts = () => strapi.db.query(oauthAccountUid as any);
const sessions = () => strapi.db.query(oauthSessionUid as any);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const jiraScopes = ['read:jira-work', 'write:jira-work', 'read:jira-user'];
type Site = { id: string; name: string; url: string };
type Grant = { accessToken: string; refreshToken: string; expiresAt: number; sites?: Site[]; clientId: string };
const seal = (grant: Grant, userId: number) => encryptToken(JSON.stringify(grant), userId);
const unseal = (value: string, userId: number): Grant => JSON.parse(decryptToken(value, userId));

export function oauthConfig(env = process.env) {
  const clientId = env.JIRA_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.JIRA_OAUTH_CLIENT_SECRET?.trim();
  const raw = env.JIRA_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !raw) throw new errors.ApplicationError('El administrador debe configurar la aplicación OAuth de Atlassian.');
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/settings/integrations/jira/callback' || (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new errors.ApplicationError('La URL de regreso OAuth no es válida.');
  }
  encryptionKey(env);
  return { clientId, clientSecret, redirectUri: url.href };
}
export function oauthAvailable() { try { oauthConfig(); return true; } catch { return false; } }

async function oauthJson(url: string, options: RequestInit) {
  let response: Response;
  try { response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { throw new errors.ApplicationError('No se pudo completar la comunicación con Atlassian. Vuelve a conectar.'); }
  if (!response.ok) throw new errors.ApplicationError('Atlassian rechazó la autorización. Vuelve a conectar tu cuenta.');
  try { return await response.json(); }
  catch { throw new errors.ApplicationError('Atlassian devolvió una respuesta inválida.'); }
}
async function exchange(body: Record<string, string>): Promise<Grant> {
  const config = oauthConfig();
  const result = await oauthJson('https://auth.atlassian.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, ...body }) }) as Record<string, unknown>;
  if (!result || typeof result.access_token !== 'string' || !result.access_token || typeof result.refresh_token !== 'string' || !result.refresh_token || typeof result.expires_in !== 'number' || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer') throw new errors.ApplicationError('La autorización no incluye un acceso renovable. Revisa los permisos de la aplicación.');
  return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + result.expires_in * 1000, clientId: config.clientId };
}
async function accessibleSites(token: string): Promise<Site[]> {
  const resources = await oauthJson('https://api.atlassian.com/oauth/token/accessible-resources', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!Array.isArray(resources)) throw new errors.ApplicationError('No se pudieron consultar los sitios autorizados.');
  const sites: Site[] = [];
  for (const item of resources) {
    if (!/^[a-zA-Z0-9-]+$/.test(item.id) || !jiraScopes.every(scope => item.scopes?.includes(scope))) continue;
    try {
      const url = new URL(item.url);
      if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.atlassian\.net$/i.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) continue;
      if (!sites.some(site => site.id === item.id)) sites.push({ id: item.id, url: url.origin, name: String(item.name || url.hostname).slice(0, 255) });
    } catch { /* Ignore non-Jira resources. */ }
  }
  return sites;
}
const credentials = (row: any, grant: Grant): JiraCredentials => ({ site: row.site, apiBase: `https://api.atlassian.com/ex/jira/${row.cloudId}`, email: '', token: grant.accessToken, userId: row.userId, authType: 'bearer',
  onUnauthorized: row.id ? async () => { await accounts().updateMany({ where: { id: row.id, revision: row.revision, encryptedGrant: row.encryptedGrant, state: 'active' }, data: { state: 'reconnect', encryptedGrant: null } }); } : undefined });

export async function startOAuth(userId: number) {
  const config = oauthConfig();
  const state = randomBytes(32).toString('hex');
  const revision = randomUUID();
  await strapi.db.transaction(async () => {
    const row = await accounts().findOne({ where: { userId } });
    if (row) await accounts().update({ where: { id: row.id, userId }, data: { revision } });
    else await accounts().create({ data: { userId, state: 'legacy', revision } });
    await sessions().deleteMany({ where: { $or: [{ userId }, { expiresAt: { $lt: new Date().toISOString() } }] } });
    await sessions().create({ data: { userId, revision, stateHash: hash(state), state: 'pending', expiresAt: new Date(Date.now() + 600000).toISOString() } });
  });
  const url = new URL('https://auth.atlassian.com/authorize');
  url.search = new URLSearchParams({ audience: 'api.atlassian.com', client_id: config.clientId, scope: [...jiraScopes, 'offline_access'].join(' '), redirect_uri: config.redirectUri, state, response_type: 'code', prompt: 'consent' }).toString();
  return { authorizationUrl: url.href };
}

export async function completeOAuth(userId: number, input: { state?: string; code?: string; error?: string }) {
  if (typeof input.state !== 'string' || !/^[a-f0-9]{64}$/.test(input.state)) throw new errors.ValidationError('La solicitud de conexión no es válida.');
  const where = { userId, stateHash: hash(input.state), state: 'pending', expiresAt: { $gt: new Date().toISOString() } };
  const claim = await sessions().updateMany({ where, data: { state: 'exchanging' } });
  if (claim.count !== 1) throw new errors.ValidationError('La solicitud venció, ya se utilizó o pertenece a otra cuenta.');
  const session = await sessions().findOne({ where: { userId, stateHash: hash(input.state) } });
  if (!session) throw new errors.ValidationError('La conexión fue cancelada.');
  try {
    if (input.error) throw new errors.ValidationError('No se autorizó la conexión con Jira. Puedes intentarlo nuevamente.');
    if (typeof input.code !== 'string' || !input.code || input.code.length > 8192) throw new errors.ValidationError('Falta el código de autorización.');
    const grant = await exchange({ grant_type: 'authorization_code', code: input.code, redirect_uri: oauthConfig().redirectUri });
    grant.sites = await accessibleSites(grant.accessToken);
    if (!grant.sites.length) throw new errors.ValidationError('No hay sitios Jira con los permisos necesarios. Revisa la autorización de la aplicación.');
    const row = await accounts().findOne({ where: { userId, revision: session.revision } });
    if (!row) throw new errors.ValidationError('La conexión cambió. Inicia una nueva autorización.');
    const updated = await sessions().updateMany({ where: { id: session.id, userId, state: 'exchanging' }, data: { encryptedGrant: seal(grant, userId), state: 'ready' } });
    if (updated.count !== 1) throw new errors.ValidationError('La conexión fue cancelada.');
    return { selectionId: session.id, sites: grant.sites };
  } catch (error) {
    await sessions().deleteMany({ where: { id: session.id, userId } });
    throw error;
  }
}

export async function pendingSites(userId: number) {
  const session = await sessions().findOne({ where: { userId, state: 'ready', expiresAt: { $gt: new Date().toISOString() } } });
  return session ? { selectionId: session.id, sites: unseal(session.encryptedGrant, userId).sites || [] } : null;
}
export async function selectOAuthSite(userId: number, selectionId: number, cloudId: string) {
  const session = await sessions().findOne({ where: { id: selectionId, userId, state: 'ready', expiresAt: { $gt: new Date().toISOString() } } });
  if (!session) throw new errors.ValidationError('La selección venció. Vuelve a conectar.');
  const grant = unseal(session.encryptedGrant, userId);
  if (grant.clientId !== oauthConfig().clientId) throw new errors.ValidationError('La aplicación OAuth cambió. Vuelve a conectar.');
  const site = grant.sites?.find(site => site.id === cloudId);
  if (!site || grant.expiresAt <= Date.now()) throw new errors.ValidationError('Selecciona un sitio autorizado y vigente.');
  const user = await jiraClient(credentials({ site: site.url, cloudId, userId }, grant))('/rest/api/3/myself');
  if (!user.accountId || user.active === false) throw new errors.ValidationError('La cuenta Jira no está disponible.');
  delete grant.sites;
  await strapi.db.transaction(async () => {
    const claimed = await sessions().updateMany({ where: { id: session.id, userId, state: 'ready' }, data: { state: 'used', encryptedGrant: null } });
    if (claimed.count !== 1) throw new errors.ValidationError('Esta selección ya se utilizó.');
    const updated = await accounts().updateMany({ where: { userId, revision: session.revision }, data: { state: 'active', revision: randomUUID(), encryptedGrant: seal(grant, userId), site: site.url, cloudId, accountName: String(user.displayName || site.name).slice(0, 255), refreshLock: null, lockExpiresAt: null } });
    if (updated.count !== 1) throw new errors.ValidationError('La conexión cambió mientras autorizabas. Vuelve a conectar.');
    await strapi.db.query('api::jira-account.jira-account' as any).updateMany({ where: { userId }, data: { enabled: false, encryptedToken: null } });
  });
  return { connected: true, site: site.url };
}

export async function disconnectOAuth(userId: number) {
  const data = { state: 'disconnected', revision: randomUUID(), encryptedGrant: null, site: null, cloudId: null, accountName: null, refreshLock: null, lockExpiresAt: null };
  await strapi.db.transaction(async () => {
    const row = await accounts().findOne({ where: { userId } });
    if (row) await accounts().update({ where: { id: row.id, userId }, data });
    else await accounts().create({ data: { userId, ...data } });
    await sessions().deleteMany({ where: { userId } });
    await strapi.db.query('api::jira-account.jira-account' as any).updateMany({ where: { userId }, data: { enabled: false, encryptedToken: null } });
  });
}
export async function oauthStatus(userId: number) {
  const row = await accounts().findOne({ where: { userId } });
  return { configured: oauthAvailable(), state: row?.state || null, connected: row?.state === 'active', reconnect: row?.state === 'reconnect', site: row?.site || null, accountName: row?.accountName || null, pending: await pendingSites(userId) };
}

// undefined allows the legacy connection; null is an explicit disconnection.
export async function resolveOAuthCredentials(userId: number): Promise<JiraCredentials | null | undefined> {
  const row = await accounts().findOne({ where: { userId } });
  if (!row || row.state === 'legacy') return undefined;
  if (row.state === 'disconnected') return null;
  const reconnect = () => new errors.ApplicationError('Reconecta tu cuenta de Jira en Mis integraciones.');
  if (row.state !== 'active') throw reconnect();
  const grant = unseal(row.encryptedGrant, userId);
  if (grant.clientId !== oauthConfig().clientId) throw reconnect();
  if (grant.expiresAt > Date.now() + 60000) return credentials(row, grant);
  const lock = randomUUID();
  const acquired = await accounts().updateMany({ where: { id: row.id, revision: row.revision, state: 'active', refreshLock: { $null: true } }, data: { refreshLock: lock, lockExpiresAt: new Date(Date.now() + 45000).toISOString() } });
  if (acquired.count !== 1) {
    if (row.refreshLock && new Date(row.lockExpiresAt).getTime() < Date.now()) {
      await accounts().updateMany({ where: { id: row.id, revision: row.revision, refreshLock: row.refreshLock }, data: { state: 'reconnect', encryptedGrant: null, refreshLock: null } });
      throw reconnect();
    }
    throw new errors.ApplicationError('La conexión Jira se está renovando. Reintenta en unos segundos.');
  }
  try {
    const next = await exchange({ grant_type: 'refresh_token', refresh_token: grant.refreshToken });
    if (!(await accessibleSites(next.accessToken)).some(site => site.id === row.cloudId && site.url === row.site)) throw reconnect();
    const encryptedGrant = seal(next, userId);
    const saved = await accounts().updateMany({ where: { id: row.id, revision: row.revision, state: 'active', refreshLock: lock }, data: { encryptedGrant, refreshLock: null, lockExpiresAt: null } });
    if (saved.count !== 1) throw reconnect();
    return credentials({ ...row, encryptedGrant }, next);
  } catch {
    await accounts().updateMany({ where: { id: row.id, revision: row.revision, refreshLock: lock }, data: { state: 'reconnect', encryptedGrant: null, refreshLock: null } });
    throw reconnect();
  }
}
