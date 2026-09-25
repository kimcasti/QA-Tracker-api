import service from '../services/automation-runner';

export default Object.fromEntries(
  ['register', 'poll', 'interrupt', 'inspect', 'details', 'enqueue', 'complete'].map(action => [
    action, async (ctx: any) => { ctx.body = { data: await service[action](ctx) }; },
  ]),
);
