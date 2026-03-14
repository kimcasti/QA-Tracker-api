export default {
  async workspace(ctx) {
    const data = await strapi.service('api::me.me').workspace(ctx.state.user.id);

    ctx.body = data;
  },
};
