import { MANAGE_ROLES, READ_ROLES } from '../../../utils/access';

// Deliberately no core router: visual metadata is only accessible through its project.
export default {
  routes: [
    { method: 'GET', path: '/projects/:documentId/canvas', handler: 'project-canvas.find',
      config: { auth: {}, policies: [{ name: 'global::tenant-access',
        config: { contentTypeUid: 'api::project.project', allowedRoles: READ_ROLES } }] } },
    { method: 'PUT', path: '/projects/:documentId/canvas', handler: 'project-canvas.update',
      config: { auth: {}, policies: [{ name: 'global::tenant-access',
        config: { contentTypeUid: 'api::project.project', allowedRoles: MANAGE_ROLES } }] } },
  ],
};
