export default {
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
