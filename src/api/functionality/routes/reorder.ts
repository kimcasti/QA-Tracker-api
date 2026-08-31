import { MANAGE_ROLES } from '../../../utils/access';

export default {
  routes: [
    {
      method: 'POST',
      path: '/functionalities/reorder',
      handler: 'functionality.reorder',
      config: {
        auth: {},
        policies: [
          {
            name: 'global::tenant-access',
            config: {
              contentTypeUid: 'api::functionality.functionality',
              allowedRoles: MANAGE_ROLES,
            },
          },
        ],
      },
    },
  ],
};
