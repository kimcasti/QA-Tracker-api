import { createHash } from 'node:crypto';
import { errors } from '@strapi/utils';

export const connectionUid = 'api::automation-connection.automation-connection';
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
export function assertConnectionProject(ctx: any, projectId: string) {
  if (ctx.state.automationConnection && ctx.state.automationConnection.projectId !== projectId) {
    throw new errors.ForbiddenError('Esta conexión pertenece a otro proyecto. Ejecuta qa:connect para cambiarla.');
  }
}
export function isActiveConnection(connection: any, now = Date.now()) {
  return Boolean(connection?.state === 'active' && new Date(connection.expiresAt).getTime() > now);
}
export async function readConnection(ctx: any) {
  const token = String(ctx.request.headers.authorization || '').replace(/^Bearer /, '');
  if (!/^qat_[a-f0-9]{64}$/.test(token)) throw new errors.UnauthorizedError('Conexión inválida.');
  const connection = await strapi.db.query(connectionUid as any).findOne({ where: { tokenHash: hashSecret(token) } });
  if (!connection || new Date(connection.expiresAt).getTime() <= Date.now() || connection.state === 'revoked') {
    throw new errors.UnauthorizedError('La conexión venció o fue revocada. Ejecuta qa:connect.');
  }
  return connection;
}
