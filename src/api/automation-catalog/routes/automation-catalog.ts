export default {
  routes: [
    { method: 'GET', path: '/automation-projects/:projectKey/catalog-connections', handler: 'automation-catalog.connections' },
    { method: 'POST', path: '/automation-projects/:projectKey/catalog-requests', handler: 'automation-catalog.request' },
    { method: 'GET', path: '/automation-projects/:projectKey/catalog-requests/:requestId', handler: 'automation-catalog.details' },
    { method: 'POST', path: '/automation-projects/:projectKey/catalog-requests/:requestId/assignments', handler: 'automation-catalog.assign' },
  ].map(route => ({ ...route, config: { auth: false, policies: ['global::automation-session'] } })),
};
