export default { routes: [
  ['GET', 'status'], ['PUT', 'save'], ['DELETE', 'disconnect'],
].map(([method, action]) => ({ method, path: '/jira-account', handler: `jira-account.${action}`,
  config: { auth: false, policies: ['global::user-session', 'global::has-active-membership'] },
})) };
