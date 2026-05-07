import { factories } from '@strapi/strapi';
import { MANAGE_ROLES, READ_ROLES } from '../../../utils/access';

export default factories.createCoreRouter(
  'api::delivery-activity-template.delivery-activity-template' as any,
  {
    config: {
      find: {
        policies: [
          {
            name: 'global::tenant-access',
            config: {
              contentTypeUid: 'api::delivery-activity-template.delivery-activity-template',
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
              contentTypeUid: 'api::delivery-activity-template.delivery-activity-template',
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
              contentTypeUid: 'api::delivery-activity-template.delivery-activity-template',
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
              contentTypeUid: 'api::delivery-activity-template.delivery-activity-template',
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
              contentTypeUid: 'api::delivery-activity-template.delivery-activity-template',
              allowedRoles: MANAGE_ROLES,
            },
          },
        ],
      },
    },
  },
);
