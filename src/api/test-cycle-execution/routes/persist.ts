import { ENGINEERING_ROLES } from '../../../utils/access';

export default {
  routes: [
    {
      method: 'PUT',
      path: '/test-cycle-executions/:documentId/persist',
      handler: 'test-cycle-execution.persist',
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
