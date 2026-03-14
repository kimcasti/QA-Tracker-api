import { factories } from '@strapi/strapi';
import { ADMIN_ROLES, MANAGE_ROLES, READ_ROLES } from '../../../utils/access';

export default factories.createCoreRouter('api::test-cycle.test-cycle', {
  config: {
    find: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::test-cycle.test-cycle', allowedRoles: READ_ROLES },
        },
      ],
    },
    findOne: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::test-cycle.test-cycle', allowedRoles: READ_ROLES },
        },
      ],
    },
    create: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::test-cycle.test-cycle', allowedRoles: MANAGE_ROLES },
        },
      ],
    },
    update: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::test-cycle.test-cycle', allowedRoles: MANAGE_ROLES },
        },
      ],
    },
    delete: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::test-cycle.test-cycle', allowedRoles: ADMIN_ROLES },
        },
      ],
    },
  },
});
