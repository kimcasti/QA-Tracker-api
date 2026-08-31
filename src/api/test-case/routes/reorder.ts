import { MANAGE_ROLES } from '../../../utils/access';

export default {
  routes: [
    {
      method: 'POST',
      path: '/test-cases/reorder',
      handler: 'test-case.reorder',
      config: {
        auth: {},
        policies: [
          {
            name: 'global::tenant-access',
            config: {
              contentTypeUid: 'api::test-case.test-case',
              allowedRoles: MANAGE_ROLES,
            },
          },
        ],
      },
    },
  ],
};
