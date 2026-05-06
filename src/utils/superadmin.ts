import type { Core } from '@strapi/strapi';

export async function isSuperAdminUser(strapi: Core.Strapi, userId?: number | null) {
  if (!userId) return false;

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
  });

  return Boolean(user?.isSuperAdmin);
}
