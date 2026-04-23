export default {
  routes: [
    {
      method: 'GET',
      path: '/me/project-contexts',
      handler: 'me.projectContexts',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
    {
      method: 'GET',
      path: '/me/workspace',
      handler: 'me.workspace',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
    {
      method: 'PUT',
      path: '/me/organization',
      handler: 'me.updateOrganization',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
  ],
};
