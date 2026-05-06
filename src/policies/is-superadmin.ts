import { errors } from '@strapi/utils';
import { isSuperAdminUser } from '../utils/superadmin';

export default async (policyContext: any) => {
  const userId = policyContext.state.user?.id;

  if (!userId) {
    throw new errors.UnauthorizedError('Authentication is required.');
  }

  if (!(await isSuperAdminUser(strapi, userId))) {
    throw new errors.ForbiddenError('Only superadmin users can access this resource.');
  }

  return true;
};
