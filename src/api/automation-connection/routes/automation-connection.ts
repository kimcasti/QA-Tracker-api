const route = (method: string, path: string, action: string, policy?: string) => ({
  method, path: `/automation-connections${path}`, handler: `automation-connection.${action}`,
  config: { auth: false, policies: policy ? [`global::${policy}`] : [] },
});
export default { routes: [
  route('POST', '/request', 'request'),
  route('POST', '/poll', 'poll'),
  route('POST', '/disconnect', 'disconnect'),
  route('POST', '/approve', 'approve', 'automation-session'),
  route('GET', '', 'list', 'automation-session'),
  route('DELETE', '/:id', 'revoke', 'automation-session'),
] };
