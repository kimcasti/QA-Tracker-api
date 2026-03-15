export default {
  routes: [
    {
      method: 'GET',
      path: '/organization-team',
      handler: 'organization-team.current',
      config: {
        auth: {},
      },
    },
    {
      method: 'POST',
      path: '/organization-team/invitations',
      handler: 'organization-team.invite',
      config: {
        auth: {},
      },
    },
    {
      method: 'PUT',
      path: '/organization-team/members/:documentId/role',
      handler: 'organization-team.updateMemberRole',
      config: {
        auth: {},
      },
    },
    {
      method: 'PUT',
      path: '/organization-team/members/:documentId/deactivate',
      handler: 'organization-team.deactivateMember',
      config: {
        auth: {},
      },
    },
    {
      method: 'POST',
      path: '/organization-team/invitations/:documentId/resend',
      handler: 'organization-team.resendInvitation',
      config: {
        auth: {},
      },
    },
    {
      method: 'PUT',
      path: '/organization-team/invitations/:documentId/cancel',
      handler: 'organization-team.cancelInvitation',
      config: {
        auth: {},
      },
    },
  ],
};
