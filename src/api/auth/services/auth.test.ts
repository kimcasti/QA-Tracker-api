import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from './auth';

function createFakeStrapi(options?: {
  authenticatedRole?: { id: number; type: string } | null;
  existingUserByEmail?: any;
  existingUsersByUsername?: Record<string, any>;
  pendingInvitation?: any;
  createdOrganization?: { documentId: string; name: string; slug: string };
  jwtFactory?: (payload: { id: number }) => string;
  addUserImpl?: (payload: any) => any;
  organizationCreateImpl?: (payload: any) => any;
  invitationUpdateImpl?: (payload: any) => any;
}) {
  const calls = {
    addedUsers: [] as any[],
    editedUsers: [] as any[],
    deletedUsers: [] as any[],
    deletedMemberships: [] as any[],
    createdOrganizations: [] as any[],
    invitationUpdates: [] as any[],
  };

  const usersByUsername = options?.existingUsersByUsername || {};

  const strapi = {
    service(uid: string) {
      if (uid === 'plugin::users-permissions.role') {
        return {
          find: async () =>
            options?.authenticatedRole === null
              ? []
              : [options?.authenticatedRole || { id: 7, type: 'authenticated' }],
        };
      }

      throw new Error(`Unexpected service uid: ${uid}`);
    },
    plugin(name: string) {
      if (name !== 'users-permissions') {
        throw new Error(`Unexpected plugin: ${name}`);
      }

      return {
        service(serviceName: string) {
          if (serviceName === 'user') {
            return {
              add: async (payload: any) => {
                calls.addedUsers.push(payload);
                if (options?.addUserImpl) {
                  return options.addUserImpl(payload);
                }

                return {
                  id: 1001,
                  username: payload.username,
                  email: payload.email,
                };
              },
              edit: async (id: number, payload: any) => {
                calls.editedUsers.push({ id, payload });
                return { id, ...payload };
              },
            };
          }

          if (serviceName === 'jwt') {
            return {
              issue: (payload: { id: number }) =>
                options?.jwtFactory ? options.jwtFactory(payload) : `jwt-${payload.id}`,
            };
          }

          throw new Error(`Unexpected plugin service: ${serviceName}`);
        },
      };
    },
    db: {
      query(uid: string) {
        if (uid === 'plugin::users-permissions.user') {
          return {
            findOne: async ({ where }: any) => {
              if (where?.email) {
                return options?.existingUserByEmail || null;
              }

              if (where?.username) {
                return usersByUsername[where.username] || null;
              }

              return null;
            },
            delete: async (payload: any) => {
              calls.deletedUsers.push(payload);
              return payload;
            },
          };
        }

        if (uid === 'api::organization-membership.organization-membership') {
          return {
            deleteMany: async (payload: any) => {
              calls.deletedMemberships.push(payload);
              return payload;
            },
          };
        }

        throw new Error(`Unexpected db uid: ${uid}`);
      },
    },
    documents(uid: string) {
      if (uid === 'api::organization-invitation.organization-invitation') {
        return {
          findFirst: async () => options?.pendingInvitation || null,
          update: async (payload: any) => {
            calls.invitationUpdates.push(payload);
            if (options?.invitationUpdateImpl) {
              return options.invitationUpdateImpl(payload);
            }
            return payload;
          },
        };
      }

      if (uid === 'api::organization.organization') {
        return {
          create: async (payload: any) => {
            calls.createdOrganizations.push(payload);
            if (options?.organizationCreateImpl) {
              return options.organizationCreateImpl(payload);
            }
            return (
              options?.createdOrganization || {
                documentId: 'org-created-1',
                name: payload.data.name,
                slug: payload.data.slug,
              }
            );
          },
        };
      }

      throw new Error(`Unexpected documents uid: ${uid}`);
    },
  };

  return { strapi: strapi as any, calls };
}

test('signup creates a starter organization for non-invited users', async () => {
  const { strapi, calls } = createFakeStrapi();
  const sideEffects = {
    bootstrapOrganizationRoles: [] as any[],
    linkInitialMembership: [] as any[],
  };

  const service = createAuthService({
    strapi,
    dependencies: {
      generateUniqueOrganizationSlug: async () => 'mi-org',
      bootstrapOrganizationRoles: async (_strapi, organizationDocumentId) => {
        sideEffects.bootstrapOrganizationRoles.push(organizationDocumentId);
      },
      linkInitialMembership: async (_strapi, organizationDocumentId, userId) => {
        sideEffects.linkInitialMembership.push({ organizationDocumentId, userId });
      },
      linkMembershipForRole: async () => {
        throw new Error('Invitation path should not run.');
      },
      sendPasswordRecoveryEmail: async () => undefined,
      createResetPasswordToken: () => 'reset-token',
      getNowIso: () => '2026-05-13T10:00:00.000Z',
    },
  });

  const result = await service.signup({
    username: 'kim',
    email: 'kim@example.com',
    password: 'secret123',
    passwordConfirmation: 'secret123',
    contactNumber: '3001234567',
    organizationName: 'Mi Org',
  });

  assert.equal(result.jwt, 'jwt-1001');
  assert.deepEqual(result.user, {
    id: 1001,
    username: 'kim',
    email: 'kim@example.com',
  });
  assert.deepEqual(result.organization, {
    documentId: 'org-created-1',
    name: 'Mi Org',
    slug: 'mi-org',
  });
  assert.equal(calls.addedUsers.length, 1);
  assert.equal(calls.createdOrganizations.length, 1);
  assert.deepEqual(sideEffects.bootstrapOrganizationRoles, ['org-created-1']);
  assert.deepEqual(sideEffects.linkInitialMembership, [
    { organizationDocumentId: 'org-created-1', userId: 1001 },
  ]);
});

test('signup accepts pending invitations without creating a new organization', async () => {
  const { strapi, calls } = createFakeStrapi({
    pendingInvitation: {
      documentId: 'invite-1',
      organization: {
        documentId: 'org-77',
        name: 'Invited Org',
        slug: 'invited-org',
      },
      organizationRole: {
        code: 'viewer',
      },
    },
  });
  const sideEffects = {
    linkedMemberships: [] as any[],
  };

  const service = createAuthService({
    strapi,
    dependencies: {
      generateUniqueOrganizationSlug: async () => {
        throw new Error('Organization path should not run.');
      },
      bootstrapOrganizationRoles: async () => {
        throw new Error('Organization path should not run.');
      },
      linkInitialMembership: async () => {
        throw new Error('Organization path should not run.');
      },
      linkMembershipForRole: async (_strapi, organizationDocumentId, userId, roleCode) => {
        sideEffects.linkedMemberships.push({ organizationDocumentId, userId, roleCode });
      },
      sendPasswordRecoveryEmail: async () => undefined,
      createResetPasswordToken: () => 'reset-token',
      getNowIso: () => '2026-05-13T10:00:00.000Z',
    },
  });

  const result = await service.signup({
    username: 'invited-user',
    email: 'invited@example.com',
    password: 'secret123',
    passwordConfirmation: 'secret123',
    contactNumber: '3001234567',
    organizationName: '',
  });

  assert.equal(calls.createdOrganizations.length, 0);
  assert.deepEqual(sideEffects.linkedMemberships, [
    { organizationDocumentId: 'org-77', userId: 1001, roleCode: 'viewer' },
  ]);
  assert.deepEqual(calls.invitationUpdates, [
    {
      documentId: 'invite-1',
      data: {
        status: 'accepted',
      },
    },
  ]);
  assert.deepEqual(result.organization, {
    documentId: 'org-77',
    name: 'Invited Org',
    slug: 'invited-org',
  });
});

test('signup rolls back accepted invitations and created users when a later step fails', async () => {
  const { strapi, calls } = createFakeStrapi({
    pendingInvitation: {
      documentId: 'invite-rollback',
      organization: {
        documentId: 'org-77',
        name: 'Invited Org',
        slug: 'invited-org',
      },
      organizationRole: {
        code: 'viewer',
      },
    },
    jwtFactory: () => {
      throw new Error('JWT issue failed');
    },
  });

  const service = createAuthService({
    strapi,
    dependencies: {
      generateUniqueOrganizationSlug: async () => 'unused',
      bootstrapOrganizationRoles: async () => undefined,
      linkInitialMembership: async () => undefined,
      linkMembershipForRole: async () => undefined,
      sendPasswordRecoveryEmail: async () => undefined,
      createResetPasswordToken: () => 'reset-token',
      getNowIso: () => '2026-05-13T10:00:00.000Z',
    },
  });

  await assert.rejects(
    () =>
      service.signup({
        username: 'rollback-user',
        email: 'rollback@example.com',
        password: 'secret123',
        passwordConfirmation: 'secret123',
        contactNumber: '3001234567',
        organizationName: '',
      }),
    /JWT issue failed/,
  );

  assert.deepEqual(calls.invitationUpdates, [
    {
      documentId: 'invite-rollback',
      data: {
        status: 'accepted',
      },
    },
    {
      documentId: 'invite-rollback',
      data: {
        status: 'pending',
      },
    },
  ]);
  assert.deepEqual(calls.deletedMemberships, [
    {
      where: { user: 1001 },
    },
  ]);
  assert.deepEqual(calls.deletedUsers, [
    {
      where: { id: 1001 },
    },
  ]);
});

test('forgotPassword clears the reset token again when email delivery fails', async () => {
  const { strapi, calls } = createFakeStrapi({
    existingUserByEmail: {
      id: 501,
      username: 'mail-user',
      email: 'mail@example.com',
      blocked: false,
    },
  });

  const service = createAuthService({
    strapi,
    dependencies: {
      generateUniqueOrganizationSlug: async () => 'unused',
      bootstrapOrganizationRoles: async () => undefined,
      linkInitialMembership: async () => undefined,
      linkMembershipForRole: async () => undefined,
      sendPasswordRecoveryEmail: async () => {
        throw new Error('SMTP down');
      },
      createResetPasswordToken: () => 'reset-token-fixed',
      getNowIso: () => '2026-05-13T10:00:00.000Z',
    },
  });

  await assert.rejects(
    () =>
      service.forgotPassword({
        email: 'mail@example.com',
      }),
    /SMTP down/,
  );

  assert.deepEqual(calls.editedUsers, [
    {
      id: 501,
      payload: {
        resetPasswordToken: 'reset-token-fixed',
      },
    },
    {
      id: 501,
      payload: {
        resetPasswordToken: null,
      },
    },
  ]);
});
