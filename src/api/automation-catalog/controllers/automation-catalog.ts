import service from '../services/automation-catalog';
export default Object.fromEntries(['connections', 'request', 'details', 'assign'].map(action => [
  action, async (ctx: any) => { ctx.body = { data: await service[action](ctx) }; },
]));
