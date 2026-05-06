export default {
  routes: [
    {
      method: 'GET',
      path: '/superadmin/organizations',
      handler: 'superadmin.organizations',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'GET',
      path: '/superadmin/billing-requests',
      handler: 'superadmin.billingRequests',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'GET',
      path: '/superadmin/organizations/:documentId/memberships',
      handler: 'superadmin.memberships',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'GET',
      path: '/superadmin/organizations/:documentId/invitations',
      handler: 'superadmin.invitations',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'GET',
      path: '/superadmin/organizations/:documentId/audit-logs',
      handler: 'superadmin.auditLogs',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'PUT',
      path: '/superadmin/organizations/:documentId',
      handler: 'superadmin.updateOrganization',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'POST',
      path: '/superadmin/organizations/:documentId/invitations',
      handler: 'superadmin.invite',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'POST',
      path: '/superadmin/invitations/:documentId/resend',
      handler: 'superadmin.resendInvitation',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'PUT',
      path: '/superadmin/invitations/:documentId/cancel',
      handler: 'superadmin.cancelInvitation',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'PUT',
      path: '/superadmin/memberships/:documentId/role',
      handler: 'superadmin.updateMembershipRole',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'PUT',
      path: '/superadmin/memberships/:documentId/deactivate',
      handler: 'superadmin.deactivateMembership',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'PUT',
      path: '/superadmin/memberships/:documentId/reactivate',
      handler: 'superadmin.reactivateMembership',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'DELETE',
      path: '/superadmin/memberships/:documentId',
      handler: 'superadmin.deleteMembership',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
    {
      method: 'PUT',
      path: '/superadmin/billing-requests/:documentId',
      handler: 'superadmin.updateBillingRequest',
      config: {
        auth: {},
        policies: ['global::is-superadmin'],
      },
    },
  ],
};
