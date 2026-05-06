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

export default async (
  policyContext: PolicyContext,
  _config: unknown,
  { strapi }: { strapi: Core.Strapi }
) => {
  const user = policyContext.state.user;

  if (!user) {
    throw new errors.UnauthorizedError('Authentication is required.');
  }

  const memberships = await getUserMemberships(strapi, user.id);

  if (memberships.length === 0) {
    throw new errors.ForbiddenError(await getUserMembershipAccessError(strapi, user.id));
  }

  return true;
};
