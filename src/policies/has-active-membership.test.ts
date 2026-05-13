import test from 'node:test';
import assert from 'node:assert/strict';
import { createHasActiveMembershipPolicy } from './has-active-membership';

test('has-active-membership rejects unauthenticated requests', async () => {
  const policy = createHasActiveMembershipPolicy({
    getUserMemberships: async () => [],
    getUserMembershipAccessError: async () => 'unused',
  });

  await assert.rejects(
    () =>
      policy(
        { state: {} },
        undefined,
        { strapi: {} as any },
      ),
    (error: Error) => {
      assert.equal(error.name, 'UnauthorizedError');
      assert.match(error.message, /Authentication is required/);
      return true;
    },
  );
});

test('has-active-membership rejects users without active memberships', async () => {
  const policy = createHasActiveMembershipPolicy({
    getUserMemberships: async () => [],
    getUserMembershipAccessError: async () => 'Your organization membership is inactive.',
  });

  await assert.rejects(
    () =>
      policy(
        { state: { user: { id: 7 } } },
        undefined,
        { strapi: {} as any },
      ),
    (error: Error) => {
      assert.equal(error.name, 'ForbiddenError');
      assert.match(error.message, /membership is inactive/i);
      return true;
    },
  );
});

test('has-active-membership allows users with active memberships', async () => {
  const policy = createHasActiveMembershipPolicy({
    getUserMemberships: async () => [{ documentId: 'membership-1' } as any],
    getUserMembershipAccessError: async () => 'unused',
  });

  const result = await policy(
    { state: { user: { id: 9 } } },
    undefined,
    { strapi: {} as any },
  );

  assert.equal(result, true);
});
