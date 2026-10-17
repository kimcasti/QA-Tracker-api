import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { errors } from '@strapi/utils';
import controller, {
  createDeactivateMemberHandler,
  createInviteHandler,
  createReactivateMemberHandler,
  createUpdateMemberProjectsHandler,
  createUpdateMemberRoleHandler,
} from './organization-team';

function createCtx(data: Record<string, unknown>, userOverrides?: Record<string, unknown>) {
  return {
    state: {
      user: {
        id: 21,
        email: 'owner@example.com',
        username: 'owner-user',
        ...userOverrides,
      },
    },
    request: {
      body: {
        data,
      },
    },
    body: undefined as unknown,
  };
}

test('organization-team invite requires a workspace project for manager and viewer roles', async () => {
  const invite = createInviteHandler({
    strapi: {
      db: {
        query() {
          throw new Error('db.query should not run for this validation');
        },
      },
      documents() {
        throw new Error('documents should not run for this validation');
      },
      log: {
        error() {},
      },
    } as any,
    dependencies: {
      ensureOwnerAccess: async () => ({
        organizationDocumentId: 'org-1',
        organizationName: 'Workspace',
        membershipDocumentId: 'mem-1',
        currentRoleCode: 'owner',
        canManage: true,
      }),
      getRoleDbRecord: async () => ({
        id: 10,
        documentId: 'role-manager',
        code: 'manager',
        name: 'Manager',
      }),
    },
  });

  await assert.rejects(
    () =>
      invite(
        createCtx({
          email: 'manager@example.com',
          roleDocumentId: 'role-manager',
        }) as any,
      ),
    (error: unknown) => {
      assert.ok(error instanceof errors.ValidationError);
      assert.equal(
        (error as Error).message,
        'Manager and Viewer invitations require at least one project assignment.',
      );
      return true;
    },
  );
});

test('organization-team invite deletes the invitation when email delivery fails', async () => {
  const deletedInvitationIds: string[] = [];

  const invite = createInviteHandler({
    strapi: {
      db: {
        query(uid: string) {
          if (uid === 'plugin::users-permissions.user') {
            return {
              findOne: async () => null,
            };
          }

          if (uid === 'api::organization-invitation.organization-invitation') {
            return {
              create: async () => ({ documentId: 'inv-1' }),
            };
          }

          throw new Error(`Unexpected db uid: ${uid}`);
        },
      },
      documents(uid: string) {
        if (uid === 'api::organization-invitation.organization-invitation') {
          return {
            findFirst: async () => null,
            delete: async ({ documentId }: { documentId: string }) => {
              deletedInvitationIds.push(documentId);
            },
          };
        }

        throw new Error(`Unexpected documents uid: ${uid}`);
      },
      log: {
        error() {},
      },
    } as any,
    dependencies: {
      ensureOwnerAccess: async () => ({
        organizationDocumentId: 'org-1',
        organizationName: 'Workspace',
        membershipDocumentId: 'mem-1',
        currentRoleCode: 'owner',
        canManage: true,
      }),
      getRoleDbRecord: async () => ({
        id: 11,
        documentId: 'role-qa',
        code: 'qa-engineer',
        name: 'QA Engineer',
      }),
      assertOrganizationLimitAvailable: async () => ({ effectivePlan: 'starter' }),
      getOrganizationDbId: async () => 99,
      resolveWorkspaceBranding: async () => ({
        workspaceProjectDocumentId: undefined,
        workspaceProjectDocumentIds: [],
        workspaceName: undefined,
        workspaceLogoUrl: undefined,
      }),
      sendInvitationEmail: async () => {
        throw new Error('SMTP unavailable');
      },
      buildTeamPayload: async () => ({ ok: true }),
      getNowIso: () => '2026-05-13T15:00:00.000Z',
    },
  });

  await assert.rejects(
    () =>
      invite(
        createCtx({
          email: 'qa@example.com',
          roleDocumentId: 'role-qa',
        }) as any,
      ),
    (error: unknown) => {
      assert.ok(error instanceof errors.ApplicationError);
      assert.equal((error as Error).message, 'SMTP unavailable');
      return true;
    },
  );

  assert.deepEqual(deletedInvitationIds, ['inv-1']);
});

test('organization-team invite preserves global blocked state and memberships while returning the rebuilt team payload', async () => {
  const existingUser = { id: 55, email: 'viewer@example.com', blocked: true };
  const memberships = [
    { documentId: 'inactive-org-1', organization: { documentId: 'org-1' }, user: { id: 55 }, isActive: false },
    { documentId: 'active-org-2', organization: { documentId: 'org-2' }, user: { id: 55 }, isActive: true },
  ];
  const originalMemberships = structuredClone(memberships);
  const blockedStateWrites: unknown[] = [];
  let stored: any;
  let delivered: any;

  const invite = createInviteHandler({
    strapi: {
      db: {
        query(uid: string) {
          if (uid === 'plugin::users-permissions.user') {
            return {
              findOne: async () => existingUser,
            };
          }

          if (uid === 'api::organization-invitation.organization-invitation') {
            return {
              create: async ({ data }: Record<string, any>) => {
                stored = data;
                return { documentId: 'inv-2', ...data };
              },
            };
          }

          throw new Error(`Unexpected db uid: ${uid}`);
        },
      },
      documents(uid: string) {
        if (uid === 'api::organization-membership.organization-membership') {
          return {
            findFirst: async ({ filters }: any) => {
              assert.deepEqual(filters, {
                organization: { documentId: 'org-1' }, user: { id: 55 }, isActive: true,
              });
              return memberships.find(membership =>
                membership.organization.documentId === filters.organization.documentId && membership.isActive,
              ) || null;
            },
          };
        }

        if (uid === 'api::organization-invitation.organization-invitation') {
          return {
            findFirst: async () => null,
            delete: async () => undefined,
          };
        }

        throw new Error(`Unexpected documents uid: ${uid}`);
      },
      log: {
        error() {},
      },
    } as any,
    dependencies: {
      ensureOwnerAccess: async () => ({
        organizationDocumentId: 'org-1',
        organizationName: 'Workspace',
        membershipDocumentId: 'mem-1',
        currentRoleCode: 'owner',
        canManage: true,
      }),
      getRoleDbRecord: async () => ({
        id: 12,
        documentId: 'role-viewer',
        code: 'viewer',
        name: 'Viewer',
      }),
      assertOrganizationLimitAvailable: async () => ({ effectivePlan: 'starter' }),
      getOrganizationDbId: async () => 88,
      resolveWorkspaceBranding: async () => ({
        workspaceProjectDocumentId: 'proj-1',
        workspaceProjectDocumentIds: ['proj-1'],
        workspaceName: 'Portal',
        workspaceLogoUrl: 'https://cdn/logo.png',
      }),
      sendInvitationEmail: async (payload: any) => { delivered = payload; },
      setUserBlockedState: async (userId: number, blocked: boolean) => {
        blockedStateWrites.push({ userId, blocked });
        existingUser.blocked = blocked;
      },
      buildTeamPayload: async () => ({
        organization: { documentId: 'org-1', name: 'Workspace' },
        invitations: [{ documentId: 'inv-2', email: 'viewer@example.com' }],
      }),
      getNowIso: () => '2026-05-13T15:30:00.000Z',
    },
  });

  const ctx = createCtx({
    email: 'viewer@example.com',
    roleDocumentId: 'role-viewer',
    workspaceProjectDocumentIds: ['proj-1'],
  });

  await invite(ctx as any);

  assert.match(delivered.invitationToken, /^[a-f0-9]{64}$/);
  assert.equal(stored.tokenHash, createHash('sha256').update(delivered.invitationToken).digest('hex'));
  assert.equal(stored.tokenExpiresAt, '2026-05-15T15:30:00.000Z');
  assert.equal(JSON.stringify(ctx.body).includes(delivered.invitationToken), false);
  // A tenant invitation is not global account recovery; a blocked user needs an administrator.
  assert.equal(existingUser.blocked, true);
  assert.deepEqual(blockedStateWrites, []);
  assert.deepEqual(memberships, originalMemberships);
  assert.deepEqual(ctx.body, {
    organization: { documentId: 'org-1', name: 'Workspace' },
    invitations: [{ documentId: 'inv-2', email: 'viewer@example.com' }],
  });
});

test('organization-team resend preserves global blocked state and memberships while rotating the invitation', async t => {
  const existingUser = { id: 55, email: 'viewer@example.com', blocked: true };
  const memberships = [
    { documentId: 'inactive-org-1', organization: { documentId: 'org-1' }, user: { id: 55 }, isActive: false },
    { documentId: 'active-org-2', organization: { documentId: 'org-2' }, user: { id: 55 }, isActive: true },
  ];
  const originalMemberships = structuredClone(memberships);
  const invitation = {
    documentId: 'inv-resend', email: existingUser.email, status: 'pending',
    tokenHash: 'ab'.repeat(32), tokenExpiresAt: '2026-01-01T00:00:00.000Z',
    organization: { documentId: 'org-1', name: 'Workspace' },
    organizationRole: { documentId: 'role-qa', code: 'qa-engineer', name: 'QA Engineer' },
  };
  const oldHash = invitation.tokenHash;
  const writes: string[] = [];
  const previousStrapi = globalThis.strapi;
  const env = { MAILTRAP_API_TOKEN: 'unit-test-only', MAIL_FROM: 'qa@example.test',
    INVITATION_APP_URL: 'https://app.example.test' };
  const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const send = t.mock.method(globalThis, 'fetch', async () => ({ ok: true } as Response));
  Object.assign(process.env, env);
  globalThis.strapi = {
    db: {
      query(uid: string) {
        assert.equal(uid, 'api::organization-invitation.organization-invitation');
        return {
          findOne: async () => invitation,
          updateMany: async ({ where, data }: any) => {
            assert.equal(where.documentId, invitation.documentId);
            assert.equal(where.tokenHash, invitation.tokenHash);
            writes.push(uid);
            Object.assign(invitation, data);
            return { count: 1 };
          },
        };
      },
    },
    documents(uid: string) {
      if (uid === 'api::organization-invitation.organization-invitation') {
        return { findOne: async () => invitation, findMany: async () => [invitation] };
      }
      if (uid === 'api::organization-membership.organization-membership') {
        return { findMany: async ({ filters }: any) => filters.user
          ? [{ documentId: 'owner-mem', isActive: true,
              organization: { documentId: 'org-1', name: 'Workspace' },
              organizationRole: { code: 'owner' } }]
          : memberships.filter(membership => membership.organization.documentId === filters.organization.documentId) };
      }
      if (uid === 'api::organization-role.organization-role') return { findMany: async () => [] };
      throw new Error(`Unexpected documents uid: ${uid}`);
    },
    log: { error() {} },
  } as any;
  try {
    const ctx = { ...createCtx({}), params: { documentId: invitation.documentId } };
    await controller.resendInvitation(ctx as any);
    assert.equal(send.mock.callCount(), 1);
    assert.notEqual(invitation.tokenHash, oldHash);
    assert.equal(invitation.status, 'pending');
    assert.equal(existingUser.blocked, true);
    assert.deepEqual(memberships, originalMemberships);
    assert.deepEqual(writes, ['api::organization-invitation.organization-invitation']);
    assert.equal((ctx.body as any).invitations[0].documentId, invitation.documentId);
    assert.equal(JSON.stringify(ctx.body).includes(invitation.tokenHash), false);
  } finally {
    globalThis.strapi = previousStrapi;
    send.mock.restore();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('organization-team updateMemberRole blocks manager/viewer role changes that require project assignment', async () => {
  const updateMemberRole = createUpdateMemberRoleHandler({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::organization-membership.organization-membership') {
          return {
            findOne: async () => ({
              documentId: 'mem-2',
              organization: { documentId: 'org-1' },
              user: { id: 44 },
            }),
            update: async () => undefined,
          };
        }

        throw new Error(`Unexpected documents uid: ${uid}`);
      },
    } as any,
    dependencies: {
      ensureOwnerAccess: async () => ({
        organizationDocumentId: 'org-1',
        organizationName: 'Workspace',
        membershipDocumentId: 'mem-1',
        currentRoleCode: 'owner',
        canManage: true,
      }),
      getRoleDbRecord: async () => ({
        id: 14,
        documentId: 'role-manager',
        code: 'manager',
        name: 'Manager',
      }),
      buildTeamPayload: async () => ({ ok: true }),
    },
  });

  await assert.rejects(
    () =>
      updateMemberRole({
        state: { user: { id: 21 } },
        params: { documentId: 'mem-2' },
        request: { body: { data: { roleDocumentId: 'role-manager' } } },
      } as any),
    (error: unknown) => {
      assert.ok(error instanceof errors.ValidationError);
      assert.match((error as Error).message, /require project assignment support/i);
      return true;
    },
  );
});

test('organization-team updateMemberProjects updates accepted invitation assignments for manager/viewer members', async () => {
  const updatedInvitations: Array<{ documentId: string; data: Record<string, unknown> }> = [];

  const updateMemberProjects = createUpdateMemberProjectsHandler({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::organization-membership.organization-membership') {
          return {
            findOne: async () => ({
              documentId: 'mem-7',
              organization: { documentId: 'org-1' },
              user: { id: 44, email: 'manager@example.com' },
              organizationRole: { code: 'manager' },
            }),
          };
        }

        if (uid === 'api::organization-invitation.organization-invitation') {
          return {
            findMany: async () => [{ documentId: 'inv-accepted-1' }, { documentId: 'inv-accepted-2' }],
            update: async ({ documentId, data }: { documentId: string; data: Record<string, unknown> }) => {
              updatedInvitations.push({ documentId, data });
            },
          };
        }

        throw new Error(`Unexpected documents uid: ${uid}`);
      },
    } as any,
    dependencies: {
      ensureOwnerAccess: async () => ({
        organizationDocumentId: 'org-1',
        organizationName: 'Workspace',
        membershipDocumentId: 'mem-owner',
        currentRoleCode: 'owner',
        canManage: true,
      }),
      resolveWorkspaceBranding: async () => ({
        workspaceProjectDocumentId: 'proj-1',
        workspaceProjectDocumentIds: ['proj-1', 'proj-2'],
        workspaceName: '2 proyectos asignados',
        workspaceLogoUrl: undefined,
      }),
      buildTeamPayload: async () => ({
        organization: { documentId: 'org-1' },
        members: [{ documentId: 'mem-7' }],
      }),
    },
  });

  const ctx = {
    state: { user: { id: 21 } },
    params: { documentId: 'mem-7' },
    request: {
      body: {
        data: {
          workspaceProjectDocumentIds: ['proj-1', 'proj-2'],
        },
      },
    },
    body: undefined as unknown,
  };

  await updateMemberProjects(ctx as any);

  assert.deepEqual(updatedInvitations, [
    {
      documentId: 'inv-accepted-1',
      data: {
        workspaceProjectDocumentId: 'proj-1',
        workspaceProjectDocumentIds: ['proj-1', 'proj-2'],
        workspaceName: '2 proyectos asignados',
      },
    },
    {
      documentId: 'inv-accepted-2',
      data: {
        workspaceProjectDocumentId: 'proj-1',
        workspaceProjectDocumentIds: ['proj-1', 'proj-2'],
        workspaceName: '2 proyectos asignados',
      },
    },
  ]);
  assert.deepEqual(ctx.body, {
    organization: { documentId: 'org-1' },
    members: [{ documentId: 'mem-7' }],
  });
});

test('organization-team updateMemberProjects rejects members without project-scoped roles', async () => {
  const updateMemberProjects = createUpdateMemberProjectsHandler({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::organization-membership.organization-membership') {
          return {
            findOne: async () => ({
              documentId: 'mem-8',
              organization: { documentId: 'org-1' },
              user: { id: 50, email: 'qa@example.com' },
              organizationRole: { code: 'qa-engineer' },
            }),
          };
        }

        throw new Error(`Unexpected documents uid: ${uid}`);
      },
    } as any,
    dependencies: {
      ensureOwnerAccess: async () => ({
        organizationDocumentId: 'org-1',
        organizationName: 'Workspace',
        membershipDocumentId: 'mem-owner',
        currentRoleCode: 'owner',
        canManage: true,
      }),
      resolveWorkspaceBranding: async () => ({
        workspaceProjectDocumentId: 'proj-1',
        workspaceProjectDocumentIds: ['proj-1'],
        workspaceName: 'Portal',
        workspaceLogoUrl: undefined,
      }),
      buildTeamPayload: async () => ({ ok: true }),
    },
  });

  await assert.rejects(
    () =>
      updateMemberProjects({
        state: { user: { id: 21 } },
        params: { documentId: 'mem-8' },
        request: { body: { data: { workspaceProjectDocumentIds: ['proj-1'] } } },
      } as any),
    (error: unknown) => {
      assert.ok(error instanceof errors.ValidationError);
      assert.match((error as Error).message, /only manager and viewer/i);
      return true;
    },
  );
});

test('organization-team deactivateMember prevents users from deactivating themselves', async () => {
  const deactivateMember = createDeactivateMemberHandler({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::organization-membership.organization-membership') {
          return {
            findOne: async () => ({
              documentId: 'mem-self',
              organization: { documentId: 'org-1' },
              user: { id: 21 },
            }),
            update: async () => undefined,
          };
        }

        throw new Error(`Unexpected documents uid: ${uid}`);
      },
    } as any,
    dependencies: {
      ensureOwnerAccess: async () => ({
        organizationDocumentId: 'org-1',
        organizationName: 'Workspace',
        membershipDocumentId: 'mem-owner',
        currentRoleCode: 'owner',
        canManage: true,
      }),
      syncUserAccessState: async () => undefined,
      buildTeamPayload: async () => ({ ok: true }),
      toNumericUserId: (value: unknown) => (typeof value === 'number' ? value : null),
    },
  });

  await assert.rejects(
    () =>
      deactivateMember({
        state: { user: { id: 21 } },
        params: { documentId: 'mem-self' },
      } as any),
    (error: unknown) => {
      assert.ok(error instanceof errors.ValidationError);
      assert.equal((error as Error).message, 'You cannot deactivate your own access.');
      return true;
    },
  );
});

test('organization-team reactivateMember re-enables the membership and unblocks the user', async () => {
  const updatedMemberships: Array<{ documentId: string; data: Record<string, unknown> }> = [];
  const unblockedUsers: number[] = [];

  const reactivateMember = createReactivateMemberHandler({
    strapi: {
      documents(uid: string) {
        if (uid === 'api::organization-membership.organization-membership') {
          return {
            findOne: async () => ({
              documentId: 'mem-3',
              organization: { documentId: 'org-1' },
              user: { id: 77 },
            }),
            update: async ({ documentId, data }: { documentId: string; data: Record<string, unknown> }) => {
              updatedMemberships.push({ documentId, data });
            },
          };
        }

        throw new Error(`Unexpected documents uid: ${uid}`);
      },
    } as any,
    dependencies: {
      ensureManageAccess: async () => ({
        organizationDocumentId: 'org-1',
        organizationName: 'Workspace',
        membershipDocumentId: 'mem-manager',
        currentRoleCode: 'qa-lead',
        canManage: true,
      }),
      setUserBlockedState: async (userId: number, blocked: boolean) => {
        if (!blocked) {
          unblockedUsers.push(userId);
        }
      },
      buildTeamPayload: async () => ({ organization: { documentId: 'org-1' }, members: [] }),
      toNumericUserId: (value: unknown) => (typeof value === 'number' ? value : null),
    },
  });

  const ctx = {
    state: { user: { id: 21 } },
    params: { documentId: 'mem-3' },
    body: undefined as unknown,
  };

  await reactivateMember(ctx as any);

  assert.deepEqual(updatedMemberships, [{ documentId: 'mem-3', data: { isActive: true } }]);
  assert.deepEqual(unblockedUsers, [77]);
  assert.deepEqual(ctx.body, { organization: { documentId: 'org-1' }, members: [] });
});
