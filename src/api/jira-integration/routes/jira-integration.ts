export default {
  routes: [
    ['GET', '/jira-integration/:projectKey', 'status'],
    ['GET', '/jira-integration/:projectKey/projects', 'projects'],
    ['GET', '/jira-integration/:projectKey/types/:jiraProjectId', 'types'],
    ['PUT', '/jira-integration/:projectKey', 'configure'],
    ['POST', '/jira-integration/:projectKey/issues', 'createIssue'],
  ].map(([method, path, action]) => ({
    method, path, handler: `jira-integration.${action}`,
    // Use the same user JWT validation as personal Jira settings. Custom global
    // roles must not block users authorized by their organization membership.
    // Project roles and credential ownership remain enforced in the controller.
    config: { auth: false, policies: ['global::user-session', 'global::has-active-membership'] },
  })),
};
