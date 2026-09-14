import { randomBytes } from 'node:crypto';
import { errors } from '@strapi/utils';
import { connectionUid, hashSecret, readConnection } from '../../../utils/automation-connection';
import { findAccessibleProject } from '../../automation-ingestion/controllers/automation-ingestion';

const db = () => strapi.db.query(connectionUid as any);
const safe = (row: any) => ({ id: row.id, label: row.label, state: row.state, projectId: row.projectId, projectKey: row.projectKey, projectName: row.projectName, expiresAt: row.expiresAt });
const buckets = new Map<string, { count: number; reset: number }>();
function rateLimit(ctx: any, action: string, max: number) {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
  const key = `${action}:${ctx.ip}`;
  const bucket = buckets.get(key) || { count: 0, reset: now + 60000 };
  if (++bucket.count > max || buckets.size > 10000) ctx.throw(429, 'Espera un minuto antes de reintentar.');
  buckets.set(key, bucket);
}
export default {
  async request(ctx: any) {
    rateLimit(ctx, 'request', 6);
    const label = String(ctx.request.body?.data?.label || '').trim();
    if (!label || label.length > 100) throw new errors.ValidationError('Nombre de conexión inválido.');
    const token = `qat_${randomBytes(32).toString('hex')}`;
    const code = randomBytes(8).toString('hex').toUpperCase();
    // Remove abandoned/expired requests. No raw token is persisted.
    await db().deleteMany({ where: { expiresAt: { $lt: new Date().toISOString() } } });
    await db().create({ data: { tokenHash: hashSecret(token), code, label, state: 'pending', expiresAt: new Date(Date.now() + 600000).toISOString() } });
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { data: { token, code, expiresIn: 600, interval: 5 } };
  },
  async poll(ctx: any) {
    rateLimit(ctx, 'poll', 60);
    ctx.set('Cache-Control', 'no-store');
    ctx.body = { data: safe(await readConnection(ctx)) };
  },
  async approve(ctx: any) {
    rateLimit(ctx, 'approve', 10);
    const { code, projectKey } = ctx.request.body?.data || {};
    if (!/^[A-F0-9]{16}$/.test(String(code))) throw new errors.ValidationError('Código inválido.');
    const project = await findAccessibleProject(ctx.state.user.id, { projectKey });
    const result = await db().updateMany({
      where: { code, state: 'pending', expiresAt: { $gt: new Date().toISOString() } },
      data: { state: 'active', code: null, userId: ctx.state.user.id, projectId: project.documentId, projectKey: project.key, projectName: project.name, expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() },
    });
    if (result.count !== 1) throw new errors.ValidationError('El código venció o ya se utilizó. Ejecuta qa:connect nuevamente.');
    ctx.body = { data: { projectKey: project.key, projectName: project.name } };
  },
  async list(ctx: any) {
    ctx.set('Cache-Control', 'no-store');
    const rows = await db().findMany({ where: { userId: ctx.state.user.id, state: 'active', expiresAt: { $gt: new Date().toISOString() } }, orderBy: { createdAt: 'desc' } });
    ctx.body = { data: rows.map(safe) };
  },
  async revoke(ctx: any) {
    await db().updateMany({ where: { id: ctx.params.id, userId: ctx.state.user.id }, data: { state: 'revoked' } });
    ctx.body = { data: { revoked: true } };
  },
  async disconnect(ctx: any) {
    const row = await readConnection(ctx);
    await db().updateMany({ where: { id: row.id }, data: { state: 'revoked' } });
    ctx.body = { data: { revoked: true } };
  },
};
