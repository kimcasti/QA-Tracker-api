export default {
  routes: [
    {
      method: 'POST',
      path: '/plan-access/ai',
      handler: 'plan-access.authorizeAi',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
    {
      method: 'POST',
      path: '/plan-access/export',
      handler: 'plan-access.authorizeExport',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
    {
      method: 'POST',
      path: '/plan-access/export/consume',
      handler: 'plan-access.consumeExport',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
    {
      method: 'POST',
      path: '/plan-access/report',
      handler: 'plan-access.authorizeReport',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
  ],
};
