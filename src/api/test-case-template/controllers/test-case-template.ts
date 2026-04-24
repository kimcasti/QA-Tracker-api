import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type TestCaseTemplatePayload = {
  name?: string;
  description?: string;
  preconditions?: string;
  testSteps?: string;
  expectedResult?: string;
  testType?: 'integration' | 'functional' | 'sanity' | 'regression' | 'smoke' | 'exploratory' | 'uat';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  isAutomated?: boolean;
  organization?: unknown;
  project?: unknown;
  module?: unknown;
};

function normalizeTemplateData(payload: TestCaseTemplatePayload) {
  return {
    name: payload.name || '',
    description: payload.description || '',
    preconditions: payload.preconditions || '',
    testSteps: payload.testSteps || '',
    expectedResult: payload.expectedResult || '',
    testType: payload.testType || 'functional',
    priority: payload.priority || 'medium',
    isAutomated: Boolean(payload.isAutomated),
  };
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

async function resolveOrganizationDocumentId(userId: number, payload: TestCaseTemplatePayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::test-case-template.test-case-template',
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

export default factories.createCoreController('api::test-case-template.test-case-template', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as TestCaseTemplatePayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);
    const moduleDocumentId = extractRelationDocumentId(payload.module);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test case template project is required.');
    }

    if (!moduleDocumentId) {
      throw new errors.ValidationError('Test case template module is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

    const created = await strapi.documents('api::test-case-template.test-case-template').create({
      data: {
        ...normalizeTemplateData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
        module: moduleDocumentId,
      },
      populate: {
        organization: true,
        project: true,
        module: true,
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
      throw new errors.ValidationError('Test case template documentId is required.');
    }

    const existing = await strapi.documents('api::test-case-template.test-case-template').findOne({
      documentId,
      populate: {
        organization: true,
        project: true,
        module: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Test case template not found.');
    }

    const payload = (ctx.request.body?.data || {}) as TestCaseTemplatePayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;
    const moduleDocumentId =
      extractRelationDocumentId(payload.module) ?? existing.module?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test case template project is required.');
    }

    if (!moduleDocumentId) {
      throw new errors.ValidationError('Test case template module is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await strapi.documents('api::test-case-template.test-case-template').update({
      documentId,
      data: {
        ...normalizeTemplateData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
        module: moduleDocumentId,
      },
      populate: {
        organization: true,
        project: true,
        module: true,
      },
    });

    ctx.body = { data: updated };
  },
}));
