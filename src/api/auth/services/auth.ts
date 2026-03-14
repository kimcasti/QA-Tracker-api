import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  bootstrapOrganizationRoles,
  generateUniqueOrganizationSlug,
  linkInitialMembership,
} from '../../../utils/bootstrap';

type SignupInput = {
  username?: string;
  email?: string;
  password?: string;
  organizationName?: string;
};

function normalizeEmail(value?: string) {
  return (value || '').trim().toLowerCase();
}

function normalizeUsername(value?: string) {
  return (value || '').trim();
}

async function getAuthenticatedRole(strapi: Core.Strapi) {
  const roles = await strapi.service('plugin::users-permissions.role').find();
  return roles.find((role: { type: string }) => role.type === 'authenticated');
}

function sanitizeUser(user: { id: number; username?: string; email?: string }) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
  };
}

export default () => ({
  async signup(payload: SignupInput) {
    const username = normalizeUsername(payload.username);
    const email = normalizeEmail(payload.email);
    const password = (payload.password || '').trim();
    const organizationName = (payload.organizationName || `${username} Workspace`).trim();

    if (!username || !email || !password) {
      throw new errors.ValidationError('Username, email and password are required.');
    }

    if (password.length < 6) {
      throw new errors.ValidationError('Password must be at least 6 characters long.');
    }

    const authenticatedRole = await getAuthenticatedRole(strapi);

    if (!authenticatedRole) {
      throw new errors.ApplicationError('Authenticated role is not configured.');
    }

    const existingByEmail = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { email },
    });
    if (existingByEmail) {
      throw new errors.ApplicationError('Email is already in use.');
    }

    const existingByUsername = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { username },
    });
    if (existingByUsername) {
      throw new errors.ApplicationError('Username is already in use.');
    }

    let createdUser: { id: number; username?: string; email?: string } | null = null;

    try {
      createdUser = await strapi.plugin('users-permissions').service('user').add({
        username,
        email,
        provider: 'local',
        password,
        confirmed: true,
        blocked: false,
        role: authenticatedRole.id,
      });

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
      await linkInitialMembership(strapi, organization.documentId, createdUser.id);

      const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: createdUser.id });

      return {
        jwt,
        user: sanitizeUser(createdUser),
        organization: {
          documentId: organization.documentId,
          name: organization.name,
          slug: organization.slug,
        },
      };
    } catch (error) {
      if (createdUser?.id) {
        await strapi.db.query('plugin::users-permissions.user').delete({
          where: { id: createdUser.id },
        });
      }

      throw error;
    }
  },
});
