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

type DeliveryUnitSummaryInput = {
  deliveryUnit?: {
    name?: string;
    type?: string;
    status?: string;
    periodLabel?: string;
    startDate?: string;
    estimatedEndDate?: string;
    baseDescription?: string;
  };
  activities?: Array<{
    name?: string;
    description?: string;
  }>;
  functionalities?: Array<{
    name?: string;
    status?: string;
    priority?: string;
    module?: string;
  }>;
  metrics?: {
    totalFunctionalities?: number;
    completed?: number;
    inProgress?: number;
    pending?: number;
    activeBugs?: number;
    testCasesCount?: number;
    progressPercent?: number;
  };
};

type TechnicalReportAnalysisInput = {
  reportType?: string;
  reportTitle?: string;
  reportPurpose?: string;
  scope?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  highlights?: unknown[];
  risks?: unknown[];
  details?: Record<string, unknown>;
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
  async providerStatus(ctx) {
    requireUserId(ctx);
    ctx.body = {
      data: strapi.service('api::ai.ai').getProviderStatus(),
    };
  },

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

  async generateDeliveryUnitSummary(ctx) {
    const userId = requireUserId(ctx);
    const data = getData(ctx);
    const projectId = requireProjectId(data);

    const payload = {
      deliveryUnit:
        data.deliveryUnit && typeof data.deliveryUnit === 'object' ? data.deliveryUnit : {},
      activities: Array.isArray(data.activities) ? data.activities : [],
      functionalities: Array.isArray(data.functionalities) ? data.functionalities : [],
      metrics: data.metrics && typeof data.metrics === 'object' ? data.metrics : {},
    } satisfies DeliveryUnitSummaryInput;

    const unitName = String(payload.deliveryUnit?.name || '').trim();
    if (!unitName) {
      throw new errors.ValidationError('Delivery unit name is required.');
    }

    const result = await strapi
      .service('api::ai.ai')
      .generateDeliveryUnitSummary(userId, {
        projectId,
        input: payload,
      });

    ctx.body = { data: result };
  },

  async analyzeTechnicalReport(ctx) {
    const userId = requireUserId(ctx);
    const data = getData(ctx);
    const projectId = requireProjectId(data);

    const payload = {
      reportType: String(data.reportType || '').trim(),
      reportTitle: String(data.reportTitle || '').trim(),
      reportPurpose: String(data.reportPurpose || '').trim(),
      scope: data.scope && typeof data.scope === 'object' ? data.scope : {},
      metrics: data.metrics && typeof data.metrics === 'object' ? data.metrics : {},
      highlights: Array.isArray(data.highlights) ? data.highlights : [],
      risks: Array.isArray(data.risks) ? data.risks : [],
      details: data.details && typeof data.details === 'object' ? data.details : {},
    } satisfies TechnicalReportAnalysisInput;

    if (!payload.reportType || !payload.reportTitle || !payload.reportPurpose) {
      throw new errors.ValidationError(
        'Report type, title and purpose are required for technical analysis.',
      );
    }

    const result = await strapi.service('api::ai.ai').analyzeTechnicalReport(userId, {
      projectId,
      input: payload,
    });

    ctx.body = { data: result };
  },
};
