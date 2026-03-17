import { factories } from '@strapi/strapi';
import { READ_ROLES } from '../../../utils/access';

export default factories.createCoreRouter('api::personal-note.personal-note' as any, {
  config: {
    find: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::personal-note.personal-note', allowedRoles: READ_ROLES },
        },
      ],
    },
    findOne: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::personal-note.personal-note', allowedRoles: READ_ROLES },
        },
      ],
    },
    create: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::personal-note.personal-note', allowedRoles: READ_ROLES },
        },
      ],
    },
    update: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::personal-note.personal-note', allowedRoles: READ_ROLES },
        },
      ],
    },
    delete: {
      policies: [
        {
          name: 'global::tenant-access',
          config: { contentTypeUid: 'api::personal-note.personal-note', allowedRoles: READ_ROLES },
        },
      ],
    },
  },
});
