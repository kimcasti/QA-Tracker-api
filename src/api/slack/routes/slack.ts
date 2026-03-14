export default {
  routes: [
    {
      method: 'GET',
      path: '/slack/members',
      handler: 'slack.members',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
  ],
};
