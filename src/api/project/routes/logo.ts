export default {
  routes: [
    {
      method: 'GET',
      path: '/projects/:documentId/logo',
      handler: 'project.publicLogo',
      config: {
        auth: false,
      },
    },
  ],
};
