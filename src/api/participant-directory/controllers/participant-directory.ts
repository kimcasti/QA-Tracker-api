export default {
  async members(ctx) {
    const userId = Number(ctx.state.user?.id || 0);
    const data = await strapi
      .service('api::participant-directory.participant-directory')
      .members(userId);

    ctx.body = { data };
  },
};
