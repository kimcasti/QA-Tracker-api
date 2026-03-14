import { factories } from '@strapi/strapi';
import { MANAGE_ROLES, READ_ROLES } from '../../../utils/access';

export default factories.createCoreRouter('api::project-module.project-module', {
  config: {
    find: {
      policies: [
        {
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::project-module.project-module',
            allowedRoles: READ_ROLES,
          },
        },
      ],
    },
    findOne: {
      policies: [
        {
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::project-module.project-module',
            allowedRoles: READ_ROLES,
          },
        },
      ],
    },
    create: {
      policies: [
        {
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::project-module.project-module',
            allowedRoles: MANAGE_ROLES,
          },
        },
      ],
    },
    update: {
      policies: [
        {
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::project-module.project-module',
            allowedRoles: MANAGE_ROLES,
          },
        },
      ],
    },
    delete: {
      policies: [
        {
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::project-module.project-module',
            allowedRoles: MANAGE_ROLES,
          },
        },
      ],
    },
  },
});
