import { errors } from '@strapi/utils';
import { accountStatus, validateAndSaveAccount, disconnectAccount } from '../../../utils/jira-account';
import { JiraRequestError } from '../../../utils/jira';

const attempts = new Map<number, { count: number; expires: number }>();
function limited(userId: number) {
  const now = Date.now();
  for (const [id, row] of attempts) if (row.expires <= now) attempts.delete(id);
  const row = attempts.get(userId) || { count: 0, expires: now + 60000 };
  attempts.set(userId, row);
  if (++row.count > 6) throw new errors.ValidationError('Espera un minuto antes de volver a validar la cuenta.');
}
function action(run: (ctx: any, userId: number) => Promise<unknown>) {
  return async (ctx: any) => {
    const userId = ctx.state.user?.id;
    if (!userId) throw new errors.UnauthorizedError('Inicia sesión en QA Tracker.');
    ctx.set('Cache-Control', 'no-store');
    try { ctx.body = { data: await run(ctx, userId) }; }
    catch (error) {
      if (error instanceof JiraRequestError) throw new errors.ValidationError(error.message);
      if (error instanceof errors.ApplicationError) throw error;
      // Never log database payloads or upstream exceptions containing credentials.
      throw new errors.ApplicationError('No se pudo guardar la conexión. Comprueba los datos y vuelve a intentarlo.');
    }
  };
}
export default {
  status: action((_ctx, userId) => accountStatus(userId)),
  save: action((ctx, userId) => { limited(userId); return validateAndSaveAccount(userId, ctx.request.body?.data || {}); }),
  disconnect: action((_ctx, userId) => disconnectAccount(userId)),
};
