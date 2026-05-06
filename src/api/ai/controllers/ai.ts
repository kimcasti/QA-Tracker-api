import { errors } from '@strapi/utils';

type ProjectInsightInput = {
  name: string;
  description?: string;
  purpose?: string;
  coreRequirements?: string[];
  businessRules?: string;
};

type ExecutionRecommendationCandidate = {
  id: string;
  name: string;
  module: string;
  priority: string;
  riskLevel: string;
  isCore: boolean;
  isRegression: boolean;
  isSmoke: boolean;
  lastFunctionalChangeAt?: string;
  roles: string[];
  testCaseCount: number;
};

function getData(ctx: any) {
  return (ctx.request.body?.data || ctx.request.body || {}) as Record<string, any>;
}

function requireUserId(ctx: any) {
  const userId = ctx.state.user?.id;

  if (!userId) {
    throw new errors.UnauthorizedError('Authentication is required.');
  }

  return userId as number;
}

function requireProjectId(data: Record<string, any>) {
  const projectId = String(data.projectId || '').trim();

  if (!projectId) {
    throw new errors.ValidationError('Project documentId is required.');
  }

  return projectId;
}

export default {
  async generateTestCases(ctx) {
    const userId = requireUserId(ctx);
    const data = getData(ctx);
    const projectId = requireProjectId(data);

    const functionalityName = String(data.functionalityName || '').trim();
    const moduleName = String(data.moduleName || '').trim();

    if (!functionalityName || !moduleName) {
      throw new errors.ValidationError('Functionality name and module name are required.');
    }

    const result = await strapi.service('api::ai.ai').generateTestCases(userId, {
      projectId,
      functionalityName,
      moduleName,
    });

    ctx.body = { data: result };
  },

  async improveMeetingNotes(ctx) {
    const userId = requireUserId(ctx);
    const data = getData(ctx);
    const projectId = requireProjectId(data);
    const notes = String(data.notes || '');

    if (!notes.trim()) {
      throw new errors.ValidationError('Notes are required.');
    }

    const result = await strapi.service('api::ai.ai').improveMeetingNotes(userId, {
      projectId,
      notes,
    });

    ctx.body = { data: result };
  },

  async recommendExecutionFunctionalities(ctx) {
    const userId = requireUserId(ctx);
    const data = getData(ctx);
    const projectId = requireProjectId(data);

    const payload = {
      projectId,
      testType: String(data.testType || '').trim(),
      selectedModules: Array.isArray(data.selectedModules) ? data.selectedModules : [],
      selectedFunctionalities: Array.isArray(data.selectedFunctionalities)
        ? (data.selectedFunctionalities as ExecutionRecommendationCandidate[])
        : [],
      candidateFunctionalities: Array.isArray(data.candidateFunctionalities)
        ? (data.candidateFunctionalities as ExecutionRecommendationCandidate[])
        : [],
      maxSuggestions:
        typeof data.maxSuggestions === 'number' ? data.maxSuggestions : undefined,
    };

    if (!payload.testType) {
      throw new errors.ValidationError('Test type is required.');
    }

    const result = await strapi
      .service('api::ai.ai')
      .recommendExecutionFunctionalities(userId, payload);

    ctx.body = { data: result };
  },

  async analyzeProject(ctx) {
    const userId = requireUserId(ctx);
    const data = getData(ctx);
    const projectId = requireProjectId(data);

    const input = {
      name: String(data.name || '').trim(),
      description: data.description ? String(data.description) : undefined,
      purpose: data.purpose ? String(data.purpose) : undefined,
      coreRequirements: Array.isArray(data.coreRequirements)
        ? data.coreRequirements.map((item: unknown) => String(item))
        : [],
      businessRules: data.businessRules ? String(data.businessRules) : undefined,
    } satisfies ProjectInsightInput;

    if (!input.name) {
      throw new errors.ValidationError('Project name is required.');
    }

    const result = await strapi.service('api::ai.ai').analyzeProject(userId, {
      projectId,
      input,
    });

    ctx.body = { data: result };
  },

  async generateProjectWireframeBrief(ctx) {
    const userId = requireUserId(ctx);
    const data = getData(ctx);
    const projectId = requireProjectId(data);

    const input = {
      name: String(data.name || '').trim(),
      description: data.description ? String(data.description) : undefined,
      purpose: data.purpose ? String(data.purpose) : undefined,
      coreRequirements: Array.isArray(data.coreRequirements)
        ? data.coreRequirements.map((item: unknown) => String(item))
        : [],
      businessRules: data.businessRules ? String(data.businessRules) : undefined,
    } satisfies ProjectInsightInput;

    if (!input.name) {
      throw new errors.ValidationError('Project name is required.');
    }

    const result = await strapi.service('api::ai.ai').generateProjectWireframeBrief(userId, {
      projectId,
      input,
    });

    ctx.body = { data: result };
  },
};
