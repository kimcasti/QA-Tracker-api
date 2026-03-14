export default {
  async members(ctx) {
    const data = await strapi.service('api::slack.slack').members();

    ctx.body = { data };
  },
};
