import type { StrapiApp } from '@strapi/strapi/admin';

export default {
  config: {
    locales: ['es'],
  },
  bootstrap(app: StrapiApp) {
    console.log(app);
  },
};
