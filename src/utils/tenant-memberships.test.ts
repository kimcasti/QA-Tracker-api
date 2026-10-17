import test from 'node:test';
import assert from 'node:assert/strict';
import { getUserMemberships } from './tenant';

function fixture(initiallyActive = false) {
  let active = initiallyActive;
  let invitationReads = 0;
  let writes = 0;
  const membership = {
    documentId: 'membership-existing', isActive: true,
    organization: { documentId: 'org-invited', name: 'Invited', slug: 'invited' },
    organizationRole: { documentId: 'role-owner', code: 'owner', name: 'Owner' },
  };
  const strapi = {
    db: { query: () => ({ findOne: async () => ({ id: 7, email: 'invited@example.test' }) }) },
    documents(uid: string) {
      if (uid === 'api::organization-membership.organization-membership') return {
        findMany: async () => active ? [membership] : [],
        findFirst: async () => ({ documentId: membership.documentId, isActive: active }),
        update: async () => { writes++; active = true; return membership; },
        findOne: async () => membership,
      };
      if (uid === 'api::organization-invitation.organization-invitation') return {
        findFirst: async () => {
          invitationReads++;
          return { documentId: 'invitation-pending', email: 'invited@example.test', status: 'pending',
            organization: membership.organization, organizationRole: membership.organizationRole };
        },
        update: async () => { writes++; return {}; },
      };
      if (uid === 'api::organization-role.organization-role') return {
        findFirst: async () => membership.organizationRole,
      };
      throw new Error('Unexpected collection: ' + uid);
    },
  };
  return { strapi: strapi as any, membership, counts: () => ({ invitationReads, writes }) };
}

test('membership lookup never claims an email-only invitation or reactivates inactive membership', async () => {
  const f = fixture();
  assert.deepEqual(await getUserMemberships(f.strapi, 7), []);
  assert.deepEqual(f.counts(), { invitationReads: 0, writes: 0 });
});

test('active memberships remain available without reading or consuming invitations', async () => {
  const f = fixture(true);
  assert.deepEqual(await getUserMemberships(f.strapi, 7), [f.membership]);
  assert.deepEqual(f.counts(), { invitationReads: 0, writes: 0 });
});
