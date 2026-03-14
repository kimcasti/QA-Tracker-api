import type { Core } from '@strapi/strapi';
import {
  backfillLocalAuthProvider,
  bootstrapAccessControl,
  bootstrapInitialOrganization,
  bootstrapInitialUser,
  bootstrapOrganizationRoles,
  disablePublicRegistration,
  linkInitialMembership,
} from './utils/bootstrap';

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await disablePublicRegistration(strapi);
    await bootstrapAccessControl(strapi);
    await backfillLocalAuthProvider(strapi);

    const organization = await bootstrapInitialOrganization(strapi);
    await bootstrapOrganizationRoles(strapi, organization.documentId);

    const user = await bootstrapInitialUser(strapi);
    await linkInitialMembership(strapi, organization.documentId, user.id);
  },
};
