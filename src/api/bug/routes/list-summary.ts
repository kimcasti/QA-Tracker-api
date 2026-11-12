import { READ_ROLES } from '../../../utils/access';

export default {
  routes: [
    {
      method: 'GET',
      path: '/bug-summaries',
      handler: 'bug.listSummary',
      config: {
        auth: {},
        policies: [
          {
            name: 'api::bug.read-access',
            config: {
              contentTypeUid: 'api::bug.bug',
              allowedRoles: READ_ROLES,
            },
          },
        ],
      },
    },
  ],
};
