import { ADMIN_ROLES, READ_ROLES } from '../../../utils/access';

export default {
  routes: [
    {
      method: 'GET',
      path: '/projects/:documentId/story-map',
      handler: 'project.storyMap',
      config: {
        auth: {},
        policies: [
          {
            name: 'global::tenant-access',
            config: {
              contentTypeUid: 'api::project.project',
              allowedRoles: READ_ROLES,
            },
          },
        ],
      },
    },
    {
      method: 'PUT',
      path: '/projects/:documentId/story-map',
      handler: 'project.upsertStoryMap',
      config: {
        auth: {},
        policies: [
          {
            name: 'global::tenant-access',
            config: {
              contentTypeUid: 'api::project.project',
              allowedRoles: ADMIN_ROLES,
            },
          },
        ],
      },
    },
  ],
};
