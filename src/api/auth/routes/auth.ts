export default {
  routes: [
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
