import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAllowedAccessRoleCodes,
  getAllowedOrganizationDocumentIds,
  isProjectAssignmentRoleCode,
} from './tenant';

test('getAllowedOrganizationDocumentIds only returns truthy organization document ids', () => {
  const memberships = [
    {
      organization: { documentId: 'org-1' },
      organizationRole: { code: 'owner' },
    },
    {
      organization: { documentId: '' },
      organizationRole: { code: 'viewer' },
    },
    {
      organizationRole: { code: 'qa-lead' },
    },
    {
      organization: { documentId: 'org-2' },
      organizationRole: { code: 'manager' },
    },
  ];

  assert.deepEqual(getAllowedOrganizationDocumentIds(memberships as any), ['org-1', 'org-2']);
});

test('getAllowedAccessRoleCodes only returns truthy role codes', () => {
  const memberships = [
    {
      organization: { documentId: 'org-1' },
      organizationRole: { code: 'owner' },
    },
    {
      organization: { documentId: 'org-2' },
      organizationRole: { code: '' },
    },
    {
      organization: { documentId: 'org-3' },
    },
    {
      organization: { documentId: 'org-4' },
      organizationRole: { code: 'viewer' },
    },
  ];

  assert.deepEqual(getAllowedAccessRoleCodes(memberships as any), ['owner', 'viewer']);
});

test('project assignment role detection stays restricted to manager and viewer', () => {
  assert.equal(isProjectAssignmentRoleCode('manager'), true);
  assert.equal(isProjectAssignmentRoleCode('viewer'), true);
  assert.equal(isProjectAssignmentRoleCode('owner'), false);
  assert.equal(isProjectAssignmentRoleCode('qa-lead'), false);
  assert.equal(isProjectAssignmentRoleCode('qa-engineer'), false);
  assert.equal(isProjectAssignmentRoleCode(undefined), false);
});
