export default {
  routes: [
    {
      method: 'POST',
      path: '/ai/test-cases/generate',
      handler: 'ai.generateTestCases',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
    {
      method: 'POST',
      path: '/ai/meeting-notes/improve',
      handler: 'ai.improveMeetingNotes',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
    {
      method: 'POST',
      path: '/ai/execution-functionalities/recommend',
      handler: 'ai.recommendExecutionFunctionalities',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
    {
      method: 'POST',
      path: '/ai/project/analyze',
      handler: 'ai.analyzeProject',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
    {
      method: 'POST',
      path: '/ai/project/wireframe-brief',
      handler: 'ai.generateProjectWireframeBrief',
      config: {
        auth: {},
        policies: ['global::has-active-membership'],
      },
    },
  ],
};
