import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type TestRunPayload = {
  title?: string;
  description?: string | null;
  executionDate?: string | null;
  status?: 'draft' | 'in_progress' | 'completed' | 'cancelled' | 'final';
  testType?: 'functional' | 'regression' | 'smoke' | 'integration' | 'uat';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  tester?: string | null;
  buildVersion?: string | null;
  environment?: 'test' | 'local' | 'production';
  selectedModules?: unknown;
  selectedFunctionalities?: unknown;
  organization?: unknown;
  project?: unknown;
  sprint?: unknown;
};

function hasOwnProperty<T extends object>(value: T, key: keyof any) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function extractRelationDocumentId(rawValue: unknown): string | null {
  if (!rawValue) return null;
  if (typeof rawValue === 'string') return rawValue;

  if (typeof rawValue === 'object') {
    const value = rawValue as {
      documentId?: string;
      connect?: Array<{ documentId?: string }>;
    };

    if (value.documentId) return value.documentId;
    if (Array.isArray(value.connect) && value.connect[0]?.documentId) {
      return value.connect[0].documentId;
    }
  }

  return null;
}

async function resolveSprintDocumentId(
  rawSprint: unknown,
  projectDocumentId: string,
  fallbackDocumentId?: string | null,
) {
  const requestedDocumentId = extractRelationDocumentId(rawSprint);

  if (requestedDocumentId) {
    const sprintByDocumentId = await strapi.documents('api::sprint.sprint').findFirst({
      filters: {
        documentId: requestedDocumentId,
        project: { documentId: projectDocumentId },
      },
    });

    if (sprintByDocumentId?.documentId) {
      return sprintByDocumentId.documentId;
    }

    const sprintByName = await strapi.documents('api::sprint.sprint').findFirst({
      filters: {
        name: requestedDocumentId,
        project: { documentId: projectDocumentId },
      },
    });

    if (sprintByName?.documentId) {
      return sprintByName.documentId;
    }
  }

  return fallbackDocumentId ?? null;
}

function buildTestRunData(payload: TestRunPayload, sprintDocumentId?: string | null) {
  const data: Record<string, unknown> = {
    title: payload.title || '',
    description: payload.description || null,
    executionDate: payload.executionDate || null,
    status: payload.status || 'draft',
    testType: payload.testType || 'functional',
    priority: payload.priority || 'medium',
    tester: payload.tester || null,
    buildVersion: payload.buildVersion || null,
    environment: payload.environment || null,
    selectedModules: Array.isArray(payload.selectedModules) ? payload.selectedModules : [],
    selectedFunctionalities: Array.isArray(payload.selectedFunctionalities)
      ? payload.selectedFunctionalities
      : [],
  };

  if (hasOwnProperty(payload, 'sprint')) {
    data.sprint = sprintDocumentId ?? null;
  }

  return data;
}

const summaryFields = [
  'documentId',
  'title',
  'description',
  'executionDate',
  'status',
  'testType',
  'priority',
  'tester',
  'buildVersion',
  'environment',
  'selectedModules',
  'selectedFunctionalities',
] as const;

const summaryPopulate = {
  project: {
    fields: ['key'],
  },
  sprint: {
    fields: ['name'],
  },
  results: {
    fields: ['result'],
  },
};

async function resolveOrganizationDocumentId(userId: number, payload: TestRunPayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::test-run.test-run',
    payload as Record<string, unknown>,
  );

  if (
    requestedOrganizationDocumentId &&
    !allowedOrganizationDocumentIds.includes(requestedOrganizationDocumentId)
  ) {
    throw new errors.ForbiddenError('Cross-organization access is not allowed.');
  }

  return requestedOrganizationDocumentId ?? allowedOrganizationDocumentIds[0];
}

export default factories.createCoreController('api::test-run.test-run', () => ({
  async listSummary(ctx) {
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const query = {
      ...sanitizedQuery,
      fields: summaryFields,
      populate: summaryPopulate,
    };

    const { results, pagination } = await strapi.service('api::test-run.test-run').find(query);
    const sanitizedResults = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedResults, { pagination });
  },

  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as TestRunPayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test run project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);
    const sprintDocumentId = await resolveSprintDocumentId(payload.sprint, projectDocumentId);

    const created = await strapi.documents('api::test-run.test-run').create({
      data: {
        ...buildTestRunData(payload, sprintDocumentId),
        organization: organizationDocumentId,
        project: projectDocumentId,
      } as any,
      populate: {
        organization: true,
        project: true,
        sprint: true,
        results: true,
      },
    });

    ctx.body = { data: created };
  },

  async update(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const documentId = ctx.params.documentId || ctx.params.id;
    if (!documentId) {
      throw new errors.ValidationError('Test run documentId is required.');
    }

    const existing = await strapi.documents('api::test-run.test-run').findOne({
      documentId,
      populate: {
        organization: true,
        project: true,
        sprint: true,
        results: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Test run not found.');
    }

    const payload = (ctx.request.body?.data || {}) as TestRunPayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test run project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });
    const sprintDocumentId = await resolveSprintDocumentId(
      payload.sprint,
      projectDocumentId,
      existing.sprint?.documentId ?? null,
    );

    const updated = await strapi.documents('api::test-run.test-run').update({
      documentId,
      data: {
        ...buildTestRunData(payload, sprintDocumentId),
        organization: organizationDocumentId,
        project: projectDocumentId,
      } as any,
      populate: {
        organization: true,
        project: true,
        sprint: true,
        results: true,
      },
    });

    ctx.body = { data: updated };
  },
}));
