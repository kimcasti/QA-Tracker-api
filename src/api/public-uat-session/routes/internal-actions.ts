import { READ_ROLES } from '../../../utils/access';

export default {
  routes: [
    {
      method: 'POST',
      path: '/public-uat-sessions/test-runs/:documentId/activate',
      handler: 'public-uat-session.activate',
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
    {
      method: 'GET',
      path: '/public-uat-sessions/test-runs/:documentId/status',
      handler: 'public-uat-session.status',
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
    {
      method: 'PUT',
      path: '/public-uat-sessions/test-runs/:documentId/revoke',
      handler: 'public-uat-session.revoke',
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
