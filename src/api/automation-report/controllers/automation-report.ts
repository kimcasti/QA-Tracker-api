import service from '../services/automation-report';

export default {
  async jobs(ctx: any) {
    ctx.body = { data: await service.jobs(ctx) };
  },
};
