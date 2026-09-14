export default {
  routes: [
    { method: 'POST', path: '/automation-client/open-run', handler: 'automation-ingestion.openRun', config: { auth: false, policies: ['global::automation-token'] } },
    { method: 'POST', path: '/automation-client/publish-results', handler: 'automation-ingestion.publishResults', config: { auth: false, policies: ['global::automation-token'] } },
    {
      method: 'POST',
      path: '/automation-ingestion/open-run',
      handler: 'automation-ingestion.openRun',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
    {
      method: 'POST',
      path: '/automation-ingestion/publish-results',
      handler: 'automation-ingestion.publishResults',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
  ],
};
