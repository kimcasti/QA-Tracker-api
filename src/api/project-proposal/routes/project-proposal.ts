import { factories } from '@strapi/strapi';
import { ADMIN_ROLES, READ_ROLES } from '../../../utils/access';

export default factories.createCoreRouter('api::project-proposal.project-proposal' as any, {
  config: {
    find: {
      policies: [
        {
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::project-proposal.project-proposal',
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
            contentTypeUid: 'api::project-proposal.project-proposal',
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
            contentTypeUid: 'api::project-proposal.project-proposal',
            allowedRoles: ADMIN_ROLES,
          },
        },
      ],
    },
    update: {
      policies: [
        {
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::project-proposal.project-proposal',
            allowedRoles: ADMIN_ROLES,
          },
        },
      ],
    },
    delete: {
      policies: [
        {
          name: 'global::tenant-access',
          config: {
            contentTypeUid: 'api::project-proposal.project-proposal',
            allowedRoles: ADMIN_ROLES,
          },
        },
      ],
    },
  },
});
