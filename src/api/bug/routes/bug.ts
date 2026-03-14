import { factories } from '@strapi/strapi';
import { ADMIN_ROLES, MANAGE_ROLES, READ_ROLES } from '../../../utils/access';

export default factories.createCoreRouter('api::bug.bug', {
  config: {
    find: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::bug.bug', allowedRoles: READ_ROLES },
        },
      ],
    },
    findOne: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::bug.bug', allowedRoles: READ_ROLES },
        },
      ],
    },
    create: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::bug.bug', allowedRoles: MANAGE_ROLES },
        },
      ],
    },
    update: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::bug.bug', allowedRoles: MANAGE_ROLES },
        },
      ],
    },
    delete: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::bug.bug', allowedRoles: ADMIN_ROLES },
        },
      ],
    },
  },
});
