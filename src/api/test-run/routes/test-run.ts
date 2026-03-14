import { factories } from '@strapi/strapi';
import { ENGINEERING_ROLES, READ_ROLES } from '../../../utils/access';

export default factories.createCoreRouter('api::test-run.test-run', {
  config: {
    find: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::test-run.test-run', allowedRoles: READ_ROLES },
        },
      ],
    },
    findOne: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::test-run.test-run', allowedRoles: READ_ROLES },
        },
      ],
    },
    create: {
      policies: [
        {
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::test-run.test-run',
            allowedRoles: ENGINEERING_ROLES,
          },
        },
      ],
    },
    update: {
      policies: [
        {
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::test-run.test-run',
            allowedRoles: ENGINEERING_ROLES,
          },
        },
      ],
    },
    delete: {
      policies: [
        {
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::test-run.test-run',
            allowedRoles: ENGINEERING_ROLES,
          },
        },
      ],
    },
  },
});
