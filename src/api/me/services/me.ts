export default () => ({
  async workspace(userId: number) {
    const memberships = await strapi
      .documents('api::organization-membership.organization-membership')
      .findMany({
        filters: {
          user: { id: userId },
          isActive: true,
        },
        populate: {
          organization: true,
          organizationRole: true,
        },
      });

    const organizationDocumentIds = memberships
      .map((membership) => membership.organization?.documentId)
      .filter(Boolean);

    const projects = organizationDocumentIds.length
      ? await strapi.documents('api::project.project').findMany({
          filters: {
            organization: {
              documentId: {
                $in: organizationDocumentIds,
              },
            },
          },
          populate: {
            organization: true,
          },
          sort: ['name:asc'],
        })
      : [];

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId },
      populate: ['role'],
    });

    return {
      user: {
        id: user?.id,
        username: user?.username,
        email: user?.email,
      },
      memberships: memberships.map((membership) => ({
        documentId: membership.documentId,
        organization: membership.organization,
        role: membership.organizationRole,
      })),
      projects,
    };
  },
});
