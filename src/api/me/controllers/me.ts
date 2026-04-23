export default {
  async projectContexts(ctx) {
    const data = await strapi.service('api::me.me').projectContexts(ctx.state.user.id);

    ctx.body = data;
  },

  async workspace(ctx) {
    const data = await strapi.service('api::me.me').workspace(ctx.state.user.id);

    ctx.body = data;
  },

  async updateOrganization(ctx) {
    const data = await strapi
      .service('api::me.me')
      .updateOrganization(ctx.state.user.id, ctx.request.body?.data?.name);

    ctx.body = { data };
  },
};
