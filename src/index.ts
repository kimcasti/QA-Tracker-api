import type { Core } from '@strapi/strapi';
import automationRunner from './api/automation-runner/services/automation-runner';
import {
  backfillLocalAuthProvider,
  bootstrapAccessControl,
  bootstrapInitialOrganization,
  bootstrapInitialUser,
  bootstrapSuperAdminUser,
  bootstrapOrganizationRoles,
  disablePublicRegistration,
  linkInitialMembership,
} from './utils/bootstrap';

let runnerTimer: ReturnType<typeof setInterval> | undefined;
let sweeping = false;
export default {
  register({ strapi }: { strapi: Core.Strapi }) {
    // Custom protocol endpoints do not accept the generated content-type CRUD schema.
    strapi.plugin('documentation')?.service('override').excludeFromGeneration(['automation-runner', 'automation-job']);
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await disablePublicRegistration(strapi);
    await bootstrapAccessControl(strapi);
    await backfillLocalAuthProvider(strapi);

    const organization = await bootstrapInitialOrganization(strapi);
    await bootstrapOrganizationRoles(strapi, organization.documentId);

    const user = await bootstrapInitialUser(strapi);
    await linkInitialMembership(strapi, organization.documentId, user.id);
    await bootstrapSuperAdminUser(strapi);
    runnerTimer = setInterval(() => {
      if (sweeping) return;
      sweeping = true;
      void automationRunner.sweep()
        .catch(() => strapi.log.error('No se pudo revisar la disponibilidad de los ejecutores.'))
        .finally(() => { sweeping = false; });
    }, 15000);
    runnerTimer.unref();
  },
  destroy() {
    if (runnerTimer) clearInterval(runnerTimer);
  },
};
