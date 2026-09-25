export default {
  routes: [
    ...['register', 'poll', 'interrupt', 'complete'].map(action => ({
      method: 'POST', path: '/automation-runner/' + action, handler: 'automation-runner.' + action,
      config: { auth: false, policies: ['global::automation-token'] },
    })),
    { method: 'GET', path: '/automation-runs/:runId/runner', handler: 'automation-runner.inspect',
      config: { auth: false, policies: ['global::automation-session'] } },
    { method: 'POST', path: '/automation-runs/:runId/jobs', handler: 'automation-runner.enqueue',
      config: { auth: false, policies: ['global::automation-session'] } },
    { method: 'GET', path: '/automation-runs/:runId/jobs/:jobId', handler: 'automation-runner.details',
      config: { auth: false, policies: ['global::automation-session'] } },
  ],
};
