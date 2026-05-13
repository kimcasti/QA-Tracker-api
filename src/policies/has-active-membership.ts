import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { getUserMembershipAccessError, getUserMemberships } from '../utils/tenant';

type PolicyContext = {
  state: {
    user?: {
      id: number;
    };
  };
};

type MembershipPolicyDependencies = {
  getUserMemberships: typeof getUserMemberships;
  getUserMembershipAccessError: typeof getUserMembershipAccessError;
};

export function createHasActiveMembershipPolicy(
  dependencies: MembershipPolicyDependencies = {
    getUserMemberships,
    getUserMembershipAccessError,
  },
) {
  return async (
    policyContext: PolicyContext,
    _config: unknown,
    { strapi }: { strapi: Core.Strapi },
  ) => {
    const user = policyContext.state.user;

    if (!user) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const memberships = await dependencies.getUserMemberships(strapi, user.id);

    if (memberships.length === 0) {
      throw new errors.ForbiddenError(
        await dependencies.getUserMembershipAccessError(strapi, user.id),
      );
    }

    return true;
  };
}

export default createHasActiveMembershipPolicy();
