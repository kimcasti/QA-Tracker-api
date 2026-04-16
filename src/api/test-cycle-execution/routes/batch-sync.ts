import { ENGINEERING_ROLES } from '../../../utils/access';

export default {
  routes: [
    {
      method: 'POST',
      path: '/test-cycle-executions/batch-sync',
      handler: 'test-cycle-execution.batchSync',
      config: {
        auth: {},
        policies: [
          {
            name: 'global::tenant-access',
            config: {
              contentTypeUid: 'api::test-cycle-execution.test-cycle-execution',
              allowedRoles: ENGINEERING_ROLES,
            },
          },
        ],
      },
    },
  ],
};
