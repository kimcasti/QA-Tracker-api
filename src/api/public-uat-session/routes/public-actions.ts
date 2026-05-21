export default {
  routes: [
    {
      method: 'GET',
      path: '/public-uat/:token',
      handler: 'public-uat-session.publicSession',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/public-uat/:token/results/:resultDocumentId',
      handler: 'public-uat-session.submitPublicResult',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/public-uat/:token/complete',
      handler: 'public-uat-session.completePublicSession',
      config: {
        auth: false,
      },
    },
  ],
};
