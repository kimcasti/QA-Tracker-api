import test from 'node:test';
import assert from 'node:assert/strict';
import { errors } from '@strapi/utils';
import {
  createDeactivateMemberHandler,
  createInviteHandler,
  createReactivateMemberHandler,
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
        'Manager and Viewer invitations require a project assignment.',
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

test('organization-team invite unblocks existing users and returns the rebuilt team payload', async () => {
  const unblockedUsers: number[] = [];

  const invite = createInviteHandler({
    strapi: {
      db: {
        query(uid: string) {
          if (uid === 'plugin::users-permissions.user') {
            return {
              findOne: async () => ({ id: 55, email: 'viewer@example.com' }),
            };
          }

          if (uid === 'api::organization-invitation.organization-invitation') {
            return {
              create: async ({ data }: Record<string, any>) => ({
                documentId: 'inv-2',
                ...data,
              }),
            };
          }

          throw new Error(`Unexpected db uid: ${uid}`);
        },
      },
      documents(uid: string) {
        if (uid === 'api::organization-membership.organization-membership') {
          return {
            findFirst: async () => null,
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
        workspaceName: 'Portal',
        workspaceLogoUrl: 'https://cdn/logo.png',
      }),
      sendInvitationEmail: async () => undefined,
      setUserBlockedState: async (userId: number, blocked: boolean) => {
        if (!blocked) {
          unblockedUsers.push(userId);
        }
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
    workspaceProjectDocumentId: 'proj-1',
  });

  await invite(ctx as any);

  assert.deepEqual(unblockedUsers, [55]);
  assert.deepEqual(ctx.body, {
    organization: { documentId: 'org-1', name: 'Workspace' },
    invitations: [{ documentId: 'inv-2', email: 'viewer@example.com' }],
  });
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
