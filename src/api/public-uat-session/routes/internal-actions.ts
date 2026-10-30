import { ADMIN_ROLES, READ_ROLES } from '../../../utils/access';

export default {
  routes: [
    ...['reopen', 'expiration'].map(action => ({
      method: 'PUT',
      path: `/public-uat-sessions/test-runs/:documentId/${action}`,
      handler: `public-uat-session.${action}`,
      config: {
        auth: {},
        policies: [{
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::test-run.test-run',
            allowedRoles: ADMIN_ROLES,
          },
        }],
      },
    })),
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
