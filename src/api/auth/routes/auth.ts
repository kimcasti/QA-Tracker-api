export default {
  routes: [
    {
      method: 'POST',
      path: '/auth/invitations/accept',
      handler: 'auth.acceptInvitation',
      // This entry point verifies the existing account password AND invitation
      // secret itself, before issuing a JWT. It must work without a membership.
      config: { auth: false, policies: [], middlewares: ['plugin::users-permissions.rateLimit'] },
    },
    {
      method: 'POST',
      path: '/auth/password/forgot',
      handler: 'auth.forgotPassword',
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/auth/signup',
      handler: 'auth.signup',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
