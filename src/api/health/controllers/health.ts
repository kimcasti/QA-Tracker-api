export default {
  async check(ctx) {
    ctx.body = {
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        requestId: ctx.state.requestId || null,
      },
    };
  },
};
