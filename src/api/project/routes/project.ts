import { factories } from '@strapi/strapi';
import { ADMIN_ROLES, READ_ROLES } from '../../../utils/access';

export default factories.createCoreRouter('api::project.project', {
  config: {
    find: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::project.project', allowedRoles: READ_ROLES },
        },
      ],
    },
    findOne: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::project.project', allowedRoles: READ_ROLES },
        },
      ],
    },
    create: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::project.project', allowedRoles: ADMIN_ROLES },
        },
      ],
    },
    update: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::project.project', allowedRoles: ADMIN_ROLES },
        },
      ],
    },
    delete: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::project.project', allowedRoles: ADMIN_ROLES },
        },
      ],
    },
  },
});
