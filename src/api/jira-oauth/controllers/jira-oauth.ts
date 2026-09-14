import { errors } from '@strapi/utils';
import { completeOAuth, oauthStatus, selectOAuthSite, startOAuth } from '../../../utils/jira-oauth';

const attempts = new Map<number, { count: number; until: number }>();
function guarded(run: (ctx: any, userId: number) => Promise<unknown>, limit = true) {
  return async (ctx: any) => {
    const userId = ctx.state.user?.id;
    if (!Number.isSafeInteger(userId) || userId < 1) throw new errors.UnauthorizedError('Inicia sesión en QA Tracker.');
    ctx.set('Cache-Control', 'no-store');
    if (limit) {
      const now = Date.now();
      for (const [id, row] of attempts) if (row.until < now) attempts.delete(id);
      const row = attempts.get(userId) || { count: 0, until: now + 60000 };
      attempts.set(userId, row);
      if (++row.count > 10) ctx.throw(429, 'Espera un minuto antes de volver a intentar.');
    }
    try { ctx.body = { data: await run(ctx, userId) }; }
    catch (error) {
      if (error instanceof errors.ApplicationError) throw error;
      throw new errors.ApplicationError('No se pudo completar la conexión de Jira. Vuelve a intentarlo desde Mis integraciones.');
    }
  };
}
export default {
  status: guarded((_ctx, id) => oauthStatus(id), false),
  start: guarded((_ctx, id) => startOAuth(id)),
  complete: guarded((ctx, id) => completeOAuth(id, ctx.request.body?.data || {})),
  selectSite: guarded((ctx, id) => {
    const { selectionId, cloudId } = ctx.request.body?.data || {};
    if (!Number.isSafeInteger(selectionId) || selectionId < 1 || typeof cloudId !== 'string' || !/^[a-zA-Z0-9-]+$/.test(cloudId)) throw new errors.ValidationError('Selecciona un sitio válido.');
    return selectOAuthSite(id, selectionId, cloudId);
  }),
};
