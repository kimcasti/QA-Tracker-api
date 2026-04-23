import { READ_ROLES } from '../../../utils/access';

export default {
  routes: [
    {
      method: 'GET',
      path: '/test-cycles/list-summary',
      handler: 'test-cycle.listSummary',
      config: {
        auth: {},
        policies: [
          {
            name: 'global::tenant-access',
            config: {
              contentTypeUid: 'api::test-cycle.test-cycle',
              allowedRoles: READ_ROLES,
            },
          },
        ],
      },
    },
  ],
};
