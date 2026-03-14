import type { Core } from '@strapi/strapi';
import set from 'lodash/set';
import { ACCESS_ROLE_SEEDS, EXPOSED_ACTIONS } from './access';

type SeededOrganization = {
  documentId: string;
  name: string;
  slug: string;
};

type OrganizationPlan = 'starter' | 'growth' | 'enterprise';

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function getAuthenticatedRole(strapi: Core.Strapi) {
  const roles = await strapi.service('plugin::users-permissions.role').find();
  return roles.find((role: { type: string }) => role.type === 'authenticated');
}

export async function generateUniqueOrganizationSlug(strapi: Core.Strapi, baseName: string) {
  const baseSlug = slugify(baseName) || `workspace-${Date.now()}`;

  let attempt = 0;
  while (attempt < 20) {
    const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const existing = await strapi.documents('api::organization.organization').findFirst({
      filters: { slug: candidate },
    });

    if (!existing) {
      return candidate;
    }

    attempt += 1;
  }

  return `${baseSlug}-${Date.now()}`;
}

export async function disablePublicRegistration(strapi: Core.Strapi) {
  const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' });
  const advancedSettings = ((await pluginStore.get({ key: 'advanced' })) || {}) as Record<
    string,
    unknown
  >;

  if (advancedSettings.allow_register !== false) {
    await pluginStore.set({
      key: 'advanced',
      value: {
        ...advancedSettings,
        allow_register: false,
      },
    });
  }
}

export async function bootstrapAccessControl(strapi: Core.Strapi) {
  const authenticatedRole = await getAuthenticatedRole(strapi);

  if (!authenticatedRole) {
    strapi.log.warn('Authenticated role not found while bootstrapping permissions.');
    return;
  }

  const roleDetail = await strapi
    .service('plugin::users-permissions.role')
    .findOne(authenticatedRole.id);

  const permissions = roleDetail.permissions;

  for (const action of EXPOSED_ACTIONS) {
    const [namespace, controller, actionName] = action.split('.').slice(0, 3);
    set(permissions, [namespace, 'controllers', controller, actionName, 'enabled'], true);
    set(permissions, [namespace, 'controllers', controller, actionName, 'policy'], '');
  }

  await strapi.service('plugin::users-permissions.role').updateRole(authenticatedRole.id, {
    name: roleDetail.name,
    description: roleDetail.description,
    permissions,
  });
}

export async function bootstrapInitialOrganization(
  strapi: Core.Strapi
): Promise<SeededOrganization> {
  const name =
    process.env.INITIAL_ORGANIZATION_NAME?.trim() || 'QA Tracker Demo';
  const slug =
    process.env.INITIAL_ORGANIZATION_SLUG?.trim() || 'qa-tracker-demo';
  const rawPlan = process.env.INITIAL_ORGANIZATION_PLAN?.trim();
  const plan: OrganizationPlan =
    rawPlan === 'growth' || rawPlan === 'enterprise' ? rawPlan : 'starter';

  const existing = await strapi.documents('api::organization.organization').findFirst({
    filters: { slug },
  });

  if (existing) {
    return {
      documentId: existing.documentId,
      name: existing.name,
      slug: existing.slug,
    };
  }

  const created = await strapi.documents('api::organization.organization').create({
    data: {
      name,
      slug,
      plan,
      status: 'active',
    },
  });

  return {
    documentId: created.documentId,
    name: created.name,
    slug: created.slug,
  };
}

export async function bootstrapOrganizationRoles(
  strapi: Core.Strapi,
  organizationDocumentId: string
) {
  for (const roleSeed of ACCESS_ROLE_SEEDS) {
    const existing = await strapi.documents('api::organization-role.organization-role').findFirst({
      filters: {
        code: roleSeed.code,
        organization: { documentId: organizationDocumentId },
      },
    });

    if (existing) continue;

    await strapi.documents('api::organization-role.organization-role').create({
      data: {
        name: roleSeed.name,
        code: roleSeed.code,
        description: roleSeed.description,
        organization: organizationDocumentId,
      },
    });
  }
}

export async function bootstrapInitialUser(strapi: Core.Strapi) {
  const authenticatedRole = await getAuthenticatedRole(strapi);

  if (!authenticatedRole) {
    throw new Error('Authenticated users-permissions role is required before creating seed user.');
  }

  const email = process.env.INITIAL_USER_EMAIL?.trim() || 'admin@qatracker.local';
  const username = process.env.INITIAL_USER_USERNAME?.trim() || 'admin';
  const password = process.env.INITIAL_USER_PASSWORD?.trim() || 'ChangeMe123!';

  const existing = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { email },
    populate: ['role'],
  });

  if (existing) {
    if (!existing.provider) {
      return strapi.db.query('plugin::users-permissions.user').update({
        where: { id: existing.id },
        data: { provider: 'local' },
        populate: ['role'],
      });
    }
    return existing;
  }

  return strapi.plugin('users-permissions').service('user').add({
    username,
    email,
    provider: 'local',
    password,
    confirmed: true,
    blocked: false,
    role: authenticatedRole.id,
  });
}

export async function backfillLocalAuthProvider(strapi: Core.Strapi) {
  const users = await strapi.db.query('plugin::users-permissions.user').findMany({
    where: {
      $or: [{ provider: null }, { provider: '' }],
    },
  });

  await Promise.all(
    users.map((user: { id: number }) =>
      strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: { provider: 'local' },
      }),
    ),
  );
}

export async function linkInitialMembership(
  strapi: Core.Strapi,
  organizationDocumentId: string,
  userId: number
) {
  const qaLeadRole = await strapi.documents('api::organization-role.organization-role').findFirst({
    filters: {
      code: 'qa-lead',
      organization: { documentId: organizationDocumentId },
    },
  });

  if (!qaLeadRole) {
    throw new Error('QA Lead access role was not created before linking the initial membership.');
  }

  const existing = await strapi.documents('api::organization-membership.organization-membership').findFirst({
    filters: {
      organization: { documentId: organizationDocumentId },
      user: { id: userId },
    },
  });

  if (existing) {
    return existing;
  }

  const organization = await strapi.db.query('api::organization.organization').findOne({
    where: { documentId: organizationDocumentId },
  });

  const organizationRole = await strapi.db.query('api::organization-role.organization-role').findOne({
    where: { documentId: qaLeadRole.documentId },
  });

  if (!organization?.id || !organizationRole?.id) {
    throw new Error('Organization membership dependencies could not be resolved.');
  }

  return strapi.db.query('api::organization-membership.organization-membership').create({
    data: {
      isActive: true,
      organization: organization.id,
      organizationRole: organizationRole.id,
      user: userId,
    },
  });
}

export async function ensureUserWorkspace(strapi: Core.Strapi, userId: number) {
  const existingMembership = await strapi
    .documents('api::organization-membership.organization-membership')
    .findFirst({
      filters: {
        isActive: true,
        user: { id: userId },
      },
      populate: {
        organization: true,
        organizationRole: true,
      },
    });

  if (existingMembership) {
    return existingMembership;
  }

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
  });

  if (!user) {
    throw new Error(`User ${userId} was not found while ensuring workspace.`);
  }

  const organizationName = `${(user.username || user.email || `user-${userId}`).trim()} Workspace`;
  const slug = await generateUniqueOrganizationSlug(strapi, organizationName);
  const organization = await strapi.documents('api::organization.organization').create({
    data: {
      name: organizationName,
      slug,
      plan: 'starter',
      status: 'active',
    },
  });

  await bootstrapOrganizationRoles(strapi, organization.documentId);
  return linkInitialMembership(strapi, organization.documentId, userId);
}
