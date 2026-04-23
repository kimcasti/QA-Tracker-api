import { READ_ROLES } from '../../../utils/access';

export default {
  routes: [
    {
      method: 'GET',
      path: '/test-runs/list-summary',
      handler: 'test-run.listSummary',
      config: {
        auth: {},
        policies: [
          {
            name: 'global::tenant-access',
            config: {
              contentTypeUid: 'api::test-run.test-run',
              allowedRoles: READ_ROLES,
            },
          },
        ],
      },
    },
  ],
};
