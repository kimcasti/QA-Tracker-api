import { ENGINEERING_ROLES } from '../../../utils/access';

export default {
  routes: [
    {
      method: 'POST',
      path: '/test-run-results/batch-sync',
      handler: 'test-run-result.batchSync',
      config: {
        auth: {},
        policies: [
          {
            name: 'global::tenant-access',
            config: {
              contentTypeUid: 'api::test-run-result.test-run-result',
              allowedRoles: ENGINEERING_ROLES,
            },
          },
        ],
      },
    },
  ],
};
