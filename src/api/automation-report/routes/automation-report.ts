import { READ_ROLES } from '../../../utils/access';

export default {
  routes: [{
    method: 'GET',
    path: '/test-runs/:documentId/automation-report-jobs',
    handler: 'automation-report.jobs',
    config: {
      // Authentication is performed by the real user-JWT policy, not runner tokens.
      auth: false,
      policies: [
        'global::automation-session',
        {
          name: 'api::automation-report.tenant-access',
          config: { contentTypeUid: 'api::test-run.test-run', allowedRoles: READ_ROLES },
        },
      ],
    },
  }],
};
