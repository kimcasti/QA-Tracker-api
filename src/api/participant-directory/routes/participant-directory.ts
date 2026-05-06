export default {
  routes: [
    {
      method: 'GET',
      path: '/participant-directory/members',
      handler: 'participant-directory.members',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
  ],
};
