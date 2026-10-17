import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from './auth';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Database } from '@strapi/database';
const invitationToken = 'ab'.repeat(32);
const invitationHash = createHash('sha256').update(invitationToken).digest('hex');

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
              validatePassword: (password: string, hash: string) => bcrypt.compare(password, hash),
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
        if (uid === 'api::organization-invitation.organization-invitation') {
          return {
            findOne: async () => options?.pendingInvitation || null,
            updateMany: async ({ where, data }: any) => {
              const row = options?.pendingInvitation;
              if (!row || row.documentId !== where.documentId || row.status !== where.status ||
                  row.tokenHash !== where.tokenHash ||
                  (where.email !== undefined && row.email !== where.email) ||
                  (where.tokenExpiresAt?.$gt && !(row.tokenExpiresAt > where.tokenExpiresAt.$gt)) ||
                  (where.tokenExpiresAt === null && row.tokenExpiresAt !== null)) return { count: 0 };
              calls.invitationUpdates.push({ documentId: row.documentId, data });
              Object.assign(row, data);
              return { count: 1 };
            },
          };
        }
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

  installTransactionAdapter(strapi, { memberships: [], users: [] });
  return { strapi: strapi as any, calls };
}

test('signup cannot claim a pending invitation using only its email', async () => {
  const { strapi, calls } = createFakeStrapi({ pendingInvitation: {
    documentId: 'unproven', organization: { documentId: 'victim-org' }, organizationRole: { code: 'owner' },
  } });
  const service = createAuthService({ strapi, dependencies: { linkMembershipForRole: async () => undefined } });
  await assert.rejects(() => service.signup({ username: 'attacker', email: 'victim@example.com',
    password: 'secret123', passwordConfirmation: 'secret123', contactNumber: '123', organizationName: '',
  }), /required|invitation/i);
  assert.equal(calls.addedUsers.length, 0);
});

test('normal signup creates its own starter organization even when its email has a pending invitation', async () => {
  const { strapi, calls } = createFakeStrapi({ pendingInvitation: {
    documentId: 'must-not-claim', email: 'kim@example.com', status: 'pending',
    organization: { documentId: 'other-org' }, organizationRole: { code: 'owner' },
  } });
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
  assert.equal(calls.invitationUpdates.length, 0);
  assert.deepEqual(sideEffects.bootstrapOrganizationRoles, ['org-created-1']);
  assert.deepEqual(sideEffects.linkInitialMembership, [
    { organizationDocumentId: 'org-created-1', userId: 1001 },
  ]);
});

test('signup accepts pending invitations without creating a new organization', async () => {
  const { strapi, calls } = createFakeStrapi({
    pendingInvitation: {
      documentId: 'invite-1', email: 'invited@example.com', status: 'pending',
      tokenHash: invitationHash, tokenExpiresAt: '2026-05-15T10:00:00.000Z',
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
    invitationDocumentId: 'invite-1', invitationToken,
    username: 'invited-user',
    email: 'invited@example.com',
    password: 'secret123',
    passwordConfirmation: 'secret123',
    contactNumber: '3001234567',
    organizationName: '',
  });

  assert.equal(calls.createdOrganizations.length, 0);
  assert.deepEqual(sideEffects.linkedMemberships, [
    // Only the organization/role from the proven invitation can be linked.
    { organizationDocumentId: 'org-77', userId: 1001, roleCode: 'viewer' },
  ]);
  assert.deepEqual(calls.invitationUpdates, [
    { documentId: 'invite-1', data: { status: 'pending', tokenHash: invitationHash, tokenExpiresAt: null } },
    { documentId: 'invite-1', data: { status: 'accepted', tokenHash: null, tokenExpiresAt: null } },
  ]);
  assert.deepEqual(result.organization, {
    documentId: 'org-77',
    name: 'Invited Org',
    slug: 'invited-org',
  });
  assert.equal(calls.addedUsers[0].confirmed, true);
  assert.equal(result.jwt, 'jwt-1001');
  assert.equal(JSON.stringify(result).includes(invitationToken), false);
});

test('signup rolls back accepted invitations and created users when a later step fails', async () => {
  const { strapi, calls } = createFakeStrapi({
    pendingInvitation: {
      documentId: 'invite-rollback', email: 'rollback@example.com', status: 'pending',
      tokenHash: invitationHash, tokenExpiresAt: '2026-05-15T10:00:00.000Z',
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
        invitationDocumentId: 'invite-rollback', invitationToken,
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
    { documentId: 'invite-rollback', data: { status: 'pending', tokenHash: invitationHash, tokenExpiresAt: null } },
  ]);
  assert.deepEqual(calls.deletedMemberships, []);
  assert.deepEqual(calls.deletedUsers, []);
});

test('signup rechecks expiry at consumption after pre-account validation', async () => {
  const { strapi, calls } = createFakeStrapi({ pendingInvitation: {
    documentId: 'inv-1', email: 'invited@example.com', status: 'pending', tokenHash: invitationHash,
    tokenExpiresAt: '2026-10-15T12:01:00.000Z', organization: { documentId: 'org-1' }, organizationRole: { code: 'viewer' },
  } });
  let clockReads = 0;
  const service = createAuthService({ strapi, dependencies: {
    getNowIso: () => clockReads++ === 0 ? '2026-10-15T12:00:00.000Z' : '2026-10-15T12:01:00.000Z',
    linkMembershipForRole: async () => undefined,
  } });
  await assert.rejects(() => service.signup({ username: 'qa', email: 'invited@example.com', password: 'secret123',
    passwordConfirmation: 'secret123', contactNumber: '123', invitationDocumentId: 'inv-1', invitationToken,
  }), /invalid or expired/i);
  assert.equal(calls.addedUsers.length, 0);
});

test('signup with explicit invitation intent rejects absent, invalid, expired, reused, legacy and other-email proof before any account writes', async () => {
  const variations = [
    { input: { invitationToken: undefined } }, { input: { invitationDocumentId: undefined } },
    { input: { invitationToken: 'wrong' } }, { input: { invitationToken: 'cd'.repeat(32) } },
    { row: { tokenExpiresAt: '2026-10-15T12:00:00.000Z' } }, { row: { status: 'accepted' } },
    { row: { tokenHash: null, tokenExpiresAt: null } }, { input: { email: 'another@example.com' } },
  ];
  for (const variation of variations) {
    const invitation = { documentId: 'inv-1', email: 'invited@example.com', status: 'pending',
      tokenHash: invitationHash, tokenExpiresAt: '2026-10-17T12:00:00.000Z',
      organization: { documentId: 'org-1' }, organizationRole: { code: 'owner' }, ...variation.row };
    const { strapi, calls } = createFakeStrapi({ pendingInvitation: invitation });
    const service = createAuthService({ strapi, dependencies: { getNowIso: () => '2026-10-15T12:00:00.000Z' } });
    await assert.rejects(() => service.signup({ username: 'qa', email: 'invited@example.com', password: 'secret123',
      passwordConfirmation: 'secret123', contactNumber: '123', organizationName: 'Do not fall back',
      invitationDocumentId: 'inv-1', invitationToken, ...variation.input,
    }), /invalid or expired/i);
    assert.equal(calls.addedUsers.length, 0);
    assert.equal(calls.createdOrganizations.length, 0);
    assert.equal(calls.invitationUpdates.length, 0);
  }
});

test('existing accounts accept only with their password and invitation proof without being replaced', async () => {
  const invitation = { documentId: 'existing-inv', email: 'existing@example.com', status: 'pending',
    tokenHash: invitationHash, tokenExpiresAt: '2026-10-17T12:00:00.000Z',
    organization: { documentId: 'org-1' }, organizationRole: { code: 'viewer' } };
  const { strapi, calls } = createFakeStrapi({ pendingInvitation: invitation,
    existingUserByEmail: { id: 55, email: 'existing@example.com', username: 'existing', confirmed: true,
      blocked: false, password: bcrypt.hashSync('correct-password', 4) } });
  const linked: any[] = [];
  const service = createAuthService({ strapi, dependencies: {
    getNowIso: () => '2026-10-15T12:00:00.000Z',
    linkMembershipForRole: async (...args: any[]) => { linked.push(args.slice(1)); },
  } });
  const payload = { email: 'existing@example.com', password: 'wrong-password',
    invitationDocumentId: 'existing-inv', invitationToken };
  await assert.rejects(() => service.acceptInvitation(payload), /credentials/i);
  assert.equal(invitation.status, 'pending');
  const result = await service.acceptInvitation({ ...payload, password: 'correct-password' });
  assert.equal(result.jwt, 'jwt-55');
  assert.deepEqual(linked, [['org-1', 55, 'viewer']]);
  assert.equal(calls.addedUsers.length, 0);
  assert.equal(calls.editedUsers.length, 0);
  assert.equal(calls.createdOrganizations.length, 0);
  await assert.rejects(() => service.acceptInvitation({ ...payload, password: 'correct-password' }), /invalid or expired/i);
});

// Execute Strapi's installed transaction/context implementation; only the SQL
// connection is substituted. No database or server is opened.
function installTransactionAdapter(strapi: any, state: { memberships: any[]; users: any[] }) {
  strapi.db.inTransaction = Database.prototype.inTransaction;
  strapi.db.transaction = Database.prototype.transaction;
  strapi.db.connection = { transaction: async () => {
    const before = structuredClone(state);
    return { commit: async () => undefined, rollback: async () => {
      state.memberships.splice(0, state.memberships.length, ...before.memberships);
      state.users.splice(0, state.users.length, ...before.users);
    } };
  } };
}

function rollbackFixture(jwtFailure = false) {
  const invitation = { documentId: 'atomic-inv', email: 'existing@example.com', status: 'pending',
    tokenHash: invitationHash, tokenExpiresAt: '2026-10-17T12:00:00.000Z',
    organization: { documentId: 'org-1' }, organizationRole: { code: 'owner' } };
  const state = { memberships: [{ documentId: 'prior', user: 55, isActive: false, role: 'viewer' }],
    users: [{ id: 55 }] };
  let jwtReached = false;
  const { strapi, calls } = createFakeStrapi({ pendingInvitation: invitation,
    existingUserByEmail: { id: 55, email: invitation.email, confirmed: true,
      password: bcrypt.hashSync('correct-password', 4) },
    jwtFactory: () => { jwtReached = true; throw new Error('JWT issue failed'); },
  });
  installTransactionAdapter(strapi, state);
  const before = structuredClone(state);
  const service = createAuthService({ strapi, dependencies: {
    getNowIso: () => '2026-10-15T12:00:00.000Z',
    linkMembershipForRole: async () => {
      // Model both reactivation/role changes and a new link before a late error.
      await Promise.resolve();
      assert.equal(strapi.db.inTransaction(), true, 'service callback must inherit Strapi transaction context');
      state.memberships[0].isActive = true;
      state.memberships[0].role = 'owner';
      state.memberships.push({ documentId: 'new', user: 55, isActive: true, role: 'owner' });
      if (!jwtFailure) throw new Error('Partial membership link failed');
    },
  } });
  return { service, state, before, invitation, calls, strapi, jwtReached: () => jwtReached,
    payload: { email: invitation.email, password: 'correct-password',
      invitationDocumentId: invitation.documentId, invitationToken } };
}

test('acceptInvitation rolls back access on JWT failure and burns the token without deleting prior memberships', async () => {
  const f = rollbackFixture(true);
  await assert.rejects(() => f.service.acceptInvitation(f.payload), /JWT issue failed/);
  assert.equal(f.jwtReached(), true);
  assert.deepEqual(f.state, f.before);
  assert.equal(f.invitation.tokenHash, invitationHash);
  assert.equal(f.invitation.tokenExpiresAt, null);
  assert.equal(f.invitation.status, 'pending');
  assert.equal(f.calls.deletedMemberships.length, 0);
  assert.equal(f.calls.deletedUsers.length, 0);
  await assert.rejects(() => f.service.acceptInvitation(f.payload), /invalid or expired/i);
});

test('acceptInvitation rolls back partial links including reactivation of prior memberships', async () => {
  const f = rollbackFixture();
  await assert.rejects(() => f.service.acceptInvitation(f.payload), /Partial membership link failed/);
  assert.deepEqual(f.state, f.before);
  assert.equal(f.jwtReached(), false);
  assert.equal(f.invitation.tokenHash, invitationHash);
  assert.equal(f.calls.deletedMemberships.length, 0);
});

test('acceptInvitation leaves token burned without publishing accepted if SQL rollback fails', async () => {
  const f = rollbackFixture();
  f.strapi.db.connection.transaction = async () => ({
    commit: async () => undefined,
    rollback: async () => { throw new Error('SQL rollback failed'); },
  });
  await assert.rejects(() => f.service.acceptInvitation(f.payload), /SQL rollback failed/);
  assert.equal(f.invitation.status, 'pending');
  assert.equal(f.invitation.tokenHash, invitationHash);
  assert.equal(f.calls.invitationUpdates.length, 1);
});

test('acceptInvitation rejects an outer transaction before consuming a secret', async () => {
  const f = rollbackFixture();
  await f.strapi.db.transaction(async () => {
    await assert.rejects(() => f.service.acceptInvitation(f.payload), /own transaction/);
  });
  assert.equal(f.invitation.tokenHash, invitationHash);
  assert.equal(f.invitation.status, 'pending');
  assert.deepEqual(f.state, f.before);
});

test('invited signup rolls back new account and partial links on link or JWT failure', async () => {
  for (const failure of ['link', 'jwt']) {
    const invitation = { documentId: 'signup-atomic', email: 'new@example.com', status: 'pending',
      tokenHash: invitationHash, tokenExpiresAt: '2026-10-17T12:00:00.000Z',
      organization: { documentId: 'org-1' }, organizationRole: { code: 'viewer' } };
    const state = { memberships: [{ documentId: 'unrelated', user: 77 }], users: [{ id: 77 }] };
    const before = structuredClone(state);
    const { strapi, calls } = createFakeStrapi({ pendingInvitation: invitation,
      addUserImpl: async () => { state.users.push({ id: 1001 }); return { id: 1001 }; },
      jwtFactory: () => { throw new Error('JWT issue failed'); },
    });
    installTransactionAdapter(strapi, state);
    const service = createAuthService({ strapi, dependencies: {
      getNowIso: () => '2026-10-15T12:00:00.000Z',
      linkMembershipForRole: async () => {
        state.memberships.push({ documentId: 'partial', user: 1001 });
        if (failure === 'link') throw new Error('Partial link failed');
      },
    } });
    await assert.rejects(() => service.signup({ username: 'new', email: invitation.email,
      password: 'secret123', passwordConfirmation: 'secret123', contactNumber: '123',
      invitationDocumentId: invitation.documentId, invitationToken,
    }), failure === 'link' ? /Partial link failed/ : /JWT issue failed/);
    assert.deepEqual(state, before);
    assert.equal(invitation.tokenHash, invitationHash);
    assert.equal(invitation.status, 'pending');
    assert.equal(calls.deletedMemberships.length, 0);
    assert.equal(calls.deletedUsers.length, 0);
  }
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
