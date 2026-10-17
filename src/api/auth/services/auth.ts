import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import crypto from 'node:crypto';
import { consumeInvitationProof, verifyInvitationProof } from '../../../utils/invitation-tokens';
import {
  bootstrapOrganizationRoles,
  generateUniqueOrganizationSlug,
  linkMembershipForRole,
  linkInitialMembership,
} from '../../../utils/bootstrap';
import { sendPasswordRecoveryEmail } from '../../../utils/mail';

type SignupInput = {
  username?: string;
  email?: string;
  password?: string;
  passwordConfirmation?: string;
  contactNumber?: string;
  organizationName?: string;
  invitationDocumentId?: string;
  invitationToken?: string;
};

type ForgotPasswordInput = {
  email?: string;
};

type AuthUserRecord = {
  id: number;
  username?: string;
  email?: string;
  blocked?: boolean;
};

type PendingInvitation = {
  documentId: string;
  organization?: {
    documentId?: string;
    name?: string;
    slug?: string;
  };
  organizationRole?: {
    code?: string;
  };
};

type AuthServiceDependencies = {
  bootstrapOrganizationRoles: typeof bootstrapOrganizationRoles;
  generateUniqueOrganizationSlug: typeof generateUniqueOrganizationSlug;
  linkMembershipForRole: typeof linkMembershipForRole;
  linkInitialMembership: typeof linkInitialMembership;
  sendPasswordRecoveryEmail: typeof sendPasswordRecoveryEmail;
  createResetPasswordToken: () => string;
  getNowIso: () => string;
};

type CreateAuthServiceInput = {
  strapi: Core.Strapi;
  dependencies?: Partial<AuthServiceDependencies>;
};

function normalizeEmail(value?: string) {
  return (value || '').trim().toLowerCase();
}

function normalizeUsername(value?: string) {
  return (value || '').trim();
}

function sanitizeUser(user: { id: number; username?: string; email?: string }) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
  };
}

function resolveDependencies(
  overrides?: Partial<AuthServiceDependencies>,
): AuthServiceDependencies {
  return {
    bootstrapOrganizationRoles,
    generateUniqueOrganizationSlug,
    linkMembershipForRole,
    linkInitialMembership,
    sendPasswordRecoveryEmail,
    createResetPasswordToken: () => crypto.randomBytes(64).toString('hex'),
    getNowIso: () => new Date().toISOString(),
    ...overrides,
  };
}

export async function findUserByUsername(strapi: Core.Strapi, username: string) {
  return strapi.db.query('plugin::users-permissions.user').findOne({
    where: { username },
  });
}

export async function resolveAvailableUsername(strapi: Core.Strapi, baseUsername: string) {
  const normalizedBase = normalizeUsername(baseUsername);

  if (!normalizedBase) return normalizedBase;

  const existingBase = await findUserByUsername(strapi, normalizedBase);
  if (!existingBase) return normalizedBase;

  let suffix = 2;
  while (suffix < 1000) {
    const candidate = `${normalizedBase}-${suffix}`;
    const existingCandidate = await findUserByUsername(strapi, candidate);
    if (!existingCandidate) return candidate;
    suffix += 1;
  }

  return `${normalizedBase}-${Date.now().toString().slice(-6)}`;
}

export async function getAuthenticatedRole(strapi: Core.Strapi) {
  const roles = await strapi.service('plugin::users-permissions.role').find();
  return roles.find((role: { type: string }) => role.type === 'authenticated');
}

export function createAuthService(input: CreateAuthServiceInput) {
  const { strapi } = input;
  const dependencies = resolveDependencies(input.dependencies);

  async function acceptWithTransaction<T>(
    proof: Parameters<typeof consumeInvitationProof>[1],
    action: (invitation: Awaited<ReturnType<typeof consumeInvitationProof>>) => Promise<T>,
  ): Promise<T> {
    // The replay barrier must survive rollback. Never run it in an outer
    // transaction whose owner could restore the consumed secret.
    if (strapi.db.inTransaction()) {
      throw new errors.ApplicationError('Invitation acceptance requires its own transaction.');
    }
    const invitation = await consumeInvitationProof(strapi, { ...proof, nowIso: dependencies.getNowIso() });
    // Burning is durable, but accepted is authorization-bearing: publish it only
    // with the access writes. The exact burned hash + null expiry fences resends,
    // including resend delivery failures that clear their replacement hash.
    return strapi.db.transaction(async () => {
      const result = await action(invitation);
      const publication = await strapi.db.query('api::organization-invitation.organization-invitation' as any).updateMany({
        where: { documentId: invitation.documentId, email: invitation.email, status: 'pending',
          tokenHash: invitation.tokenHash, tokenExpiresAt: null },
        data: { status: 'accepted', tokenHash: null, tokenExpiresAt: null },
      });
      if (publication.count !== 1) {
        throw new errors.ValidationError('Invitation is invalid or expired. Request a new invitation email.');
      }
      return result;
    });
  }

  return {
    async acceptInvitation(payload: Pick<SignupInput, 'email' | 'password' | 'invitationDocumentId' | 'invitationToken'>) {
      const email = normalizeEmail(payload.email);
      const proof = { documentId: payload.invitationDocumentId, token: payload.invitationToken,
        email, nowIso: dependencies.getNowIso() };
      await verifyInvitationProof(strapi, proof);
      const user = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { email } });
      if (!user || user.email !== email || user.blocked || user.confirmed === false ||
          user.provider !== undefined && user.provider !== 'local' || !user.password ||
          typeof payload.password !== 'string' || !payload.password ||
          !await strapi.plugin('users-permissions').service('user').validatePassword(payload.password, user.password)) {
        throw new errors.ValidationError('Invalid account credentials.');
      }
      return acceptWithTransaction(proof, async (invitation) => {
        await dependencies.linkMembershipForRole(strapi, invitation.organization.documentId, user.id,
          invitation.organizationRole.code);
        const jwt = await strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
        return { jwt, user: sanitizeUser(user) };
      });
    },

    async forgotPassword(payload: ForgotPasswordInput) {
      const email = normalizeEmail(payload.email);

      if (!email) {
        throw new errors.ValidationError('Email is required.');
      }

      const user = (await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email },
      })) as AuthUserRecord | null;

      if (!user || user.blocked) {
        return { ok: true };
      }

      const resetPasswordToken = dependencies.createResetPasswordToken();

      await strapi.plugin('users-permissions').service('user').edit(user.id, {
        resetPasswordToken,
      });

      try {
        await dependencies.sendPasswordRecoveryEmail({
          recipientEmail: user.email!,
          username: user.username,
          resetToken: resetPasswordToken,
        });
      } catch (error) {
        await strapi.plugin('users-permissions').service('user').edit(user.id, {
          resetPasswordToken: null,
        });
        throw error;
      }

      return { ok: true };
    },

    async signup(payload: SignupInput) {
      const requestedUsername = normalizeUsername(payload.username);
      const email = normalizeEmail(payload.email);
      const password = (payload.password || '').trim();
      const passwordConfirmation = (payload.passwordConfirmation || '').trim();
      const contactNumber = (payload.contactNumber || '').trim();
      const organizationName = (payload.organizationName || '').trim();
      const proof = { documentId: payload.invitationDocumentId, token: payload.invitationToken,
        email, nowIso: dependencies.getNowIso() };
      const hasInvitationProof = payload.invitationDocumentId !== undefined || payload.invitationToken !== undefined;
      const pendingInvitation: PendingInvitation | null = hasInvitationProof
        ? await verifyInvitationProof(strapi, proof) : null;
      let username = requestedUsername;

      if (
        !requestedUsername ||
        !email ||
        !password ||
        !passwordConfirmation ||
        !contactNumber ||
        (!organizationName && !pendingInvitation)
      ) {
        throw new errors.ValidationError(
          'Username, email, password, password confirmation, contact number and organization name are required.',
        );
      }

      if (password.length < 6) {
        throw new errors.ValidationError('Password must be at least 6 characters long.');
      }

      if (password !== passwordConfirmation) {
        throw new errors.ValidationError('Password confirmation does not match.');
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

      const existingByUsername = await findUserByUsername(strapi, username);
      if (existingByUsername) {
        if (!pendingInvitation) {
          throw new errors.ApplicationError('Username is already in use.');
        }

        username = await resolveAvailableUsername(strapi, username);
      }

      const completeSignup = async (invitation: PendingInvitation | null = null) => {
        let createdUser: AuthUserRecord | null = null;
        try {
          createdUser = await strapi.plugin('users-permissions').service('user').add({
            username,
            email,
            provider: 'local',
            password,
            contactNumber,
            confirmed: true,
            blocked: false,
            role: authenticatedRole.id,
          });

          let organizationPayload: { documentId: string; name: string; slug: string } | null = null;

          if (invitation?.organization?.documentId && invitation.organizationRole?.code) {
            await dependencies.linkMembershipForRole(
              strapi,
              invitation.organization.documentId,
              createdUser.id,
              invitation.organizationRole.code,
            );

            organizationPayload = {
              documentId: invitation.organization.documentId,
              name: invitation.organization.name || '',
              slug: invitation.organization.slug || '',
            };
          } else {
            const slug = await dependencies.generateUniqueOrganizationSlug(strapi, organizationName);
            const organization = await strapi.documents('api::organization.organization').create({
              data: {
                name: organizationName,
                slug,
                plan: 'starter',
                status: 'active',
                planStatus: 'active',
                planUpdatedAt: dependencies.getNowIso(),
                aiUsageThisMonth: 0,
                aiResetAt: null,
                aiLimit: null,
                exportUsageThisMonth: 0,
                usageResetAt: null,
                exportLimitMonthly: null,
                billingNotes: null,
                planExpiresAt: null,
                gracePeriodEndsAt: null,
              },
            });

            await dependencies.bootstrapOrganizationRoles(strapi, organization.documentId);
            await dependencies.linkInitialMembership(strapi, organization.documentId, createdUser.id);

            organizationPayload = {
              documentId: organization.documentId,
              name: organization.name,
              slug: organization.slug,
            };
          }

          const jwt = await strapi.plugin('users-permissions').service('jwt').issue({ id: createdUser.id });

          return {
            jwt,
            user: sanitizeUser(createdUser),
            organization: organizationPayload,
          };
        } catch (error) {
          // Invitation account/link writes are rolled back together by Strapi;
          // never compensate by deleting a user's preexisting memberships.
          if (pendingInvitation) throw error;

          if (createdUser?.id) {
            await strapi.db.query('api::organization-membership.organization-membership').deleteMany({
              where: { user: createdUser.id },
            });
            await strapi.db.query('plugin::users-permissions.user').delete({
              where: { id: createdUser.id },
            });
          }

          throw error;
        }
      };
      return pendingInvitation
        ? acceptWithTransaction(proof, completeSignup)
        : completeSignup();
    },
  };
}

export default () => createAuthService({ strapi });
