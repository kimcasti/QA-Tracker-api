export default {
  routes: [
    {
      method: 'POST',
      path: '/billing/upgrade-request',
      handler: 'billing-request.requestUpgrade',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
  ],
};
