import tenantAccess from '../../../policies/tenant-access';

// Authorize at the route without mixing server-only tenant predicates into the
// client's query. The controller reapplies that scope AFTER query sanitization.
const readAccess: typeof tenantAccess = async (policyContext, config, { strapi }) =>
  tenantAccess({ ...policyContext, query: {} }, config, { strapi });

export default readAccess;
