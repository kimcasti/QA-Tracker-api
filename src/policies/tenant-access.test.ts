import test from 'node:test';
import assert from 'node:assert/strict';
import { createTenantAccessPolicy } from './tenant-access';

function createPolicyContext(input?: Partial<{
  userId: number;
  method: string;
  documentId: string;
  bodyData: Record<string, unknown>;
  query: Record<string, unknown>;
}>) {
  return {
    state: input?.userId ? { user: { id: input.userId } } : {},
    params: {
      documentId: input?.documentId,
    },
    query: input?.query,
    request: {
      method: input?.method || 'GET',
      body: input?.bodyData ? { data: input.bodyData } : undefined,
    },
  };
}

function createMembership(roleCode: string, organizationDocumentId: string) {
  return {
    documentId: `membership-${organizationDocumentId}-${roleCode}`,
    organization: {
      documentId: organizationDocumentId,
    },
    organizationRole: {
      code: roleCode,
    },
  } as any;
}

test('tenant-access rejects unauthenticated requests', async () => {
  const policy = createTenantAccessPolicy({
    getUserMembershipAccessError: async () => 'unused',
    getAllowedAccessRoleCodes: () => [],
    getAllowedOrganizationDocumentIds: () => [],
    getOrganizationDocumentIdFromEntity: async () => null,
    getOrganizationDocumentIdFromPayload: async () => null,
    getProjectDocumentIdFromEntity: async () => null,
    getProjectDocumentIdFromPayload: async () => null,
    getUserProjectAccessScope: async () => ({
      allowedOrganizationDocumentIds: [],
      unrestrictedOrganizationDocumentIds: [],
      restrictedOrganizationDocumentIds: [],
      allowedProjectDocumentIds: [],
      hasProjectRestrictions: false,
    }),
    getUserMemberships: async () => [],
  });

  await assert.rejects(
    () =>
      policy(
        createPolicyContext(),
        { contentTypeUid: 'api::project.project' },
        { strapi: {} as any },
      ),
    (error: Error) => {
      assert.equal(error.name, 'UnauthorizedError');
      assert.match(error.message, /Authentication is required/);
      return true;
    },
  );
});

test('tenant-access rejects users without organization access', async () => {
  const policy = createTenantAccessPolicy({
    getUserMembershipAccessError: async () => 'An active organization membership is required.',
    getAllowedAccessRoleCodes: () => [],
    getAllowedOrganizationDocumentIds: () => [],
    getOrganizationDocumentIdFromEntity: async () => null,
    getOrganizationDocumentIdFromPayload: async () => null,
    getProjectDocumentIdFromEntity: async () => null,
    getProjectDocumentIdFromPayload: async () => null,
    getUserProjectAccessScope: async () => ({
      allowedOrganizationDocumentIds: [],
      unrestrictedOrganizationDocumentIds: [],
      restrictedOrganizationDocumentIds: [],
      allowedProjectDocumentIds: [],
      hasProjectRestrictions: false,
    }),
    getUserMemberships: async () => [],
  });

  await assert.rejects(
    () =>
      policy(
        createPolicyContext({ userId: 1 }),
        { contentTypeUid: 'api::project.project' },
        { strapi: {} as any },
      ),
    (error: Error) => {
      assert.equal(error.name, 'ForbiddenError');
      assert.match(error.message, /active organization membership/i);
      return true;
    },
  );
});

test('tenant-access rejects roles that are not allowed for the action', async () => {
  const memberships = [createMembership('viewer', 'org-1')];
  const policy = createTenantAccessPolicy({
    getUserMembershipAccessError: async () => 'unused',
    getAllowedAccessRoleCodes: () => ['viewer'],
    getAllowedOrganizationDocumentIds: () => ['org-1'],
    getOrganizationDocumentIdFromEntity: async () => null,
    getOrganizationDocumentIdFromPayload: async () => null,
    getProjectDocumentIdFromEntity: async () => null,
    getProjectDocumentIdFromPayload: async () => null,
    getUserProjectAccessScope: async () => ({
      allowedOrganizationDocumentIds: ['org-1'],
      unrestrictedOrganizationDocumentIds: ['org-1'],
      restrictedOrganizationDocumentIds: [],
      allowedProjectDocumentIds: [],
      hasProjectRestrictions: false,
    }),
    getUserMemberships: async () => memberships,
  });

  await assert.rejects(
    () =>
      policy(
        createPolicyContext({ userId: 1 }),
        { contentTypeUid: 'api::project.project', allowedRoles: ['owner'] },
        { strapi: {} as any },
      ),
    (error: Error) => {
      assert.equal(error.name, 'ForbiddenError');
      assert.match(error.message, /cannot perform this action/i);
      return true;
    },
  );
});

test('tenant-access injects organization filters for list GET requests', async () => {
  const memberships = [createMembership('owner', 'org-1')];
  const policy = createTenantAccessPolicy({
    getUserMembershipAccessError: async () => 'unused',
    getAllowedAccessRoleCodes: () => ['owner'],
    getAllowedOrganizationDocumentIds: () => ['org-1'],
    getOrganizationDocumentIdFromEntity: async () => null,
    getOrganizationDocumentIdFromPayload: async () => null,
    getProjectDocumentIdFromEntity: async () => null,
    getProjectDocumentIdFromPayload: async () => null,
    getUserProjectAccessScope: async () => ({
      allowedOrganizationDocumentIds: ['org-1'],
      unrestrictedOrganizationDocumentIds: ['org-1'],
      restrictedOrganizationDocumentIds: [],
      allowedProjectDocumentIds: [],
      hasProjectRestrictions: false,
    }),
    getUserMemberships: async () => memberships,
  });

  const context = createPolicyContext({
    userId: 1,
    method: 'GET',
    query: {
      filters: {
        status: {
          $eq: 'active',
        },
      },
    },
  });

  const result = await policy(
    context,
    { contentTypeUid: 'api::project.project', allowedRoles: ['owner'] },
    { strapi: {} as any },
  );

  assert.equal(result, true);
  assert.deepEqual(context.query, {
    filters: {
      status: {
        $eq: 'active',
      },
      organization: {
        documentId: {
          $in: ['org-1'],
        },
      },
    },
  });
});

test('tenant-access injects project restriction filters when the role is project-scoped', async () => {
  const memberships = [createMembership('viewer', 'org-1')];
  const policy = createTenantAccessPolicy({
    getUserMembershipAccessError: async () => 'unused',
    getAllowedAccessRoleCodes: () => ['viewer'],
    getAllowedOrganizationDocumentIds: () => ['org-1'],
    getOrganizationDocumentIdFromEntity: async () => null,
    getOrganizationDocumentIdFromPayload: async () => null,
    getProjectDocumentIdFromEntity: async () => null,
    getProjectDocumentIdFromPayload: async () => null,
    getUserProjectAccessScope: async () => ({
      allowedOrganizationDocumentIds: ['org-1'],
      unrestrictedOrganizationDocumentIds: [],
      restrictedOrganizationDocumentIds: ['org-1'],
      allowedProjectDocumentIds: ['proj-1', 'proj-2'],
      hasProjectRestrictions: true,
    }),
    getUserMemberships: async () => memberships,
  });

  const context = createPolicyContext({
    userId: 1,
    method: 'GET',
  });

  const result = await policy(
    context,
    { contentTypeUid: 'api::functionality.functionality', allowedRoles: ['viewer'] },
    { strapi: {} as any },
  );

  assert.equal(result, true);
  assert.deepEqual(context.query, {
    filters: {
      organization: {
        documentId: {
          $in: ['org-1'],
        },
      },
      project: {
        documentId: {
          $in: ['proj-1', 'proj-2'],
        },
      },
    },
  });
});

test('tenant-access blocks cross-organization payloads', async () => {
  const memberships = [createMembership('owner', 'org-1')];
  const policy = createTenantAccessPolicy({
    getUserMembershipAccessError: async () => 'unused',
    getAllowedAccessRoleCodes: () => ['owner'],
    getAllowedOrganizationDocumentIds: () => ['org-1'],
    getOrganizationDocumentIdFromEntity: async () => null,
    getOrganizationDocumentIdFromPayload: async () => 'org-2',
    getProjectDocumentIdFromEntity: async () => null,
    getProjectDocumentIdFromPayload: async () => null,
    getUserProjectAccessScope: async () => ({
      allowedOrganizationDocumentIds: ['org-1'],
      unrestrictedOrganizationDocumentIds: ['org-1'],
      restrictedOrganizationDocumentIds: [],
      allowedProjectDocumentIds: [],
      hasProjectRestrictions: false,
    }),
    getUserMemberships: async () => memberships,
  });

  await assert.rejects(
    () =>
      policy(
        createPolicyContext({
          userId: 1,
          method: 'POST',
          bodyData: {
            name: 'Cross org item',
            organization: { documentId: 'org-2' },
          },
        }),
        { contentTypeUid: 'api::project.project', allowedRoles: ['owner'] },
        { strapi: {} as any },
      ),
    (error: Error) => {
      assert.equal(error.name, 'ForbiddenError');
      assert.match(error.message, /Cross-organization access is not allowed/i);
      return true;
    },
  );
});

test('tenant-access blocks project-scoped users outside assigned projects', async () => {
  const memberships = [createMembership('viewer', 'org-1')];
  const policy = createTenantAccessPolicy({
    getUserMembershipAccessError: async () => 'unused',
    getAllowedAccessRoleCodes: () => ['viewer'],
    getAllowedOrganizationDocumentIds: () => ['org-1'],
    getOrganizationDocumentIdFromEntity: async () => null,
    getOrganizationDocumentIdFromPayload: async () => 'org-1',
    getProjectDocumentIdFromEntity: async () => null,
    getProjectDocumentIdFromPayload: async () => 'proj-2',
    getUserProjectAccessScope: async () => ({
      allowedOrganizationDocumentIds: ['org-1'],
      unrestrictedOrganizationDocumentIds: [],
      restrictedOrganizationDocumentIds: ['org-1'],
      allowedProjectDocumentIds: ['proj-1'],
      hasProjectRestrictions: true,
    }),
    getUserMemberships: async () => memberships,
  });

  await assert.rejects(
    () =>
      policy(
        createPolicyContext({
          userId: 1,
          method: 'PUT',
          bodyData: {
            name: 'Restricted project item',
            project: { documentId: 'proj-2' },
          },
        }),
        { contentTypeUid: 'api::functionality.functionality', allowedRoles: ['viewer'] },
        { strapi: {} as any },
      ),
    (error: Error) => {
      assert.equal(error.name, 'ForbiddenError');
      assert.match(error.message, /not assigned to this project/i);
      return true;
    },
  );
});

test('tenant-access allows entity operations inside allowed organization and assigned project', async () => {
  const memberships = [createMembership('qa-lead', 'org-1')];
  const policy = createTenantAccessPolicy({
    getUserMembershipAccessError: async () => 'unused',
    getAllowedAccessRoleCodes: () => ['qa-lead'],
    getAllowedOrganizationDocumentIds: () => ['org-1'],
    getOrganizationDocumentIdFromEntity: async () => 'org-1',
    getOrganizationDocumentIdFromPayload: async () => null,
    getProjectDocumentIdFromEntity: async () => 'proj-1',
    getProjectDocumentIdFromPayload: async () => null,
    getUserProjectAccessScope: async () => ({
      allowedOrganizationDocumentIds: ['org-1'],
      unrestrictedOrganizationDocumentIds: ['org-1'],
      restrictedOrganizationDocumentIds: [],
      allowedProjectDocumentIds: ['proj-1'],
      hasProjectRestrictions: false,
    }),
    getUserMemberships: async () => memberships,
  });

  const result = await policy(
    createPolicyContext({
      userId: 11,
      method: 'PUT',
      documentId: 'item-1',
    }),
    { contentTypeUid: 'api::functionality.functionality', allowedRoles: ['qa-lead'] },
    { strapi: {} as any },
  );

  assert.equal(result, true);
});
