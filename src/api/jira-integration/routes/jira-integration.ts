export default {
  routes: [
    ['GET', '/jira-integration/:projectKey', 'status'],
    ['GET', '/jira-integration/:projectKey/projects', 'projects'],
    ['GET', '/jira-integration/:projectKey/types/:jiraProjectId', 'types'],
    ['PUT', '/jira-integration/:projectKey', 'configure'],
    ['POST', '/jira-integration/:projectKey/issues', 'createIssue'],
  ].map(([method, path, action]) => ({
    method, path, handler: `jira-integration.${action}`,
    // Strapi action permissions plus project/account authorization in the controller.
    config: { auth: {}, policies: ['global::has-active-membership'] },
  })),
};
