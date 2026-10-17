export default {
  async acceptInvitation(ctx) {
    ctx.set('Cache-Control', 'no-store');
    ctx.body = await strapi.service('api::auth.auth').acceptInvitation(ctx.request.body ?? {});
  },
  async forgotPassword(ctx) {
    const payload = ctx.request.body ?? {};
    const result = await strapi.service('api::auth.auth').forgotPassword(payload);

    ctx.body = result;
  },

  async signup(ctx) {
    const payload = ctx.request.body ?? {};
    const result = await strapi.service('api::auth.auth').signup(payload);

    ctx.body = result;
  },
};
