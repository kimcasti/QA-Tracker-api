import { factories } from '@strapi/strapi';
import { READ_ROLES } from '../../../utils/access';

// Session mutations must pass through the lifecycle actions, which validate
// test-run and participant ownership plus token/expiry/lock invariants.
export default factories.createCoreRouter(
  'api::public-uat-session.public-uat-session' as any,
  {
    only: ['find', 'findOne'],
    config: {
      find: {
        policies: [{
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::public-uat-session.public-uat-session',
            allowedRoles: READ_ROLES,
          },
        }],
      },
      findOne: {
        policies: [{
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::public-uat-session.public-uat-session',
            allowedRoles: READ_ROLES,
          },
        }],
      },
    },
  },
);
