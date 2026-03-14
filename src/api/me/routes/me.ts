export default {
  routes: [
    {
      method: 'GET',
      path: '/me/workspace',
      handler: 'me.workspace',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
  ],
};
