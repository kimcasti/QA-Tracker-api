export default {
  routes: [
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
