export default { routes: [
  ['GET', '', 'status'], ['POST', '/start', 'start'], ['POST', '/complete', 'complete'], ['POST', '/select-site', 'selectSite'],
].map(([method, path, action]) => ({ method, path: `/jira-oauth${path}`, handler: `jira-oauth.${action}`, config: { auth: false, policies: ['global::user-session', 'global::has-active-membership'] } })) };
