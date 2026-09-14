import { errors } from '@strapi/utils';

// These management routes accept only a real user JWT, never an automation token.
// Authorization is enforced by ownership and project membership in the controller.
export default async (ctx: any) => {
  try {
    const token = String(ctx.request.headers.authorization || '').replace(/^Bearer /, '');
    const claims = await strapi.plugin('users-permissions').service('jwt').verify(token);
    if (!Number.isSafeInteger(claims.id) || claims.id < 1) throw new Error('Invalid subject');
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: claims.id } });
    if (!user || user.blocked || !user.confirmed) throw new Error('Invalid user');
    ctx.state.user = user;
    return true;
  } catch {
    throw new errors.UnauthorizedError('Inicia sesión en QA Tracker.');
  }
};
