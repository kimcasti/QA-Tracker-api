import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type TestCasePayload = {
  title?: string;
  description?: string;
  preconditions?: string;
  testSteps?: string;
  expectedResult?: string;
  testType?:
    | 'integration'
    | 'functional'
    | 'sanity'
    | 'regression'
    | 'smoke'
    | 'exploratory'
    | 'uat';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  isAutomated?: boolean;
  organization?: unknown;
  project?: unknown;
  functionality?: unknown;
};

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

function buildTestCaseData(payload: TestCasePayload) {
  return {
    title: payload.title || '',
    description: payload.description || '',
    preconditions: payload.preconditions || '',
    testSteps: payload.testSteps || '',
    expectedResult: payload.expectedResult || '',
    testType: payload.testType || 'functional',
    priority: payload.priority || 'medium',
    isAutomated: Boolean(payload.isAutomated),
  };
}

async function resolveOrganizationDocumentId(userId: number, payload: TestCasePayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::test-case.test-case',
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

async function resolveFunctionalityDocumentId(
  rawFunctionality: unknown,
  projectDocumentId: string,
  fallbackDocumentId?: string | null,
) {
  const requestedDocumentId = extractRelationDocumentId(rawFunctionality);

  if (requestedDocumentId) {
    const functionalityByDocumentId = await strapi
      .documents('api::functionality.functionality')
      .findFirst({
        filters: {
          documentId: requestedDocumentId,
          project: { documentId: projectDocumentId },
        },
      });

    if (functionalityByDocumentId?.documentId) {
      return functionalityByDocumentId.documentId;
    }

    const functionalityByCode = await strapi.documents('api::functionality.functionality').findFirst({
      filters: {
        code: requestedDocumentId,
        project: { documentId: projectDocumentId },
      },
    });

    if (functionalityByCode?.documentId) {
      return functionalityByCode.documentId;
    }
  }

  if (fallbackDocumentId) {
    return fallbackDocumentId;
  }

  return null;
}

export default factories.createCoreController('api::test-case.test-case', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as TestCasePayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test case project is required.');
    }

    const functionalityDocumentId = await resolveFunctionalityDocumentId(
      payload.functionality,
      projectDocumentId,
    );

    if (!functionalityDocumentId) {
      throw new errors.ValidationError('Test case functionality is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

    const created = await strapi.documents('api::test-case.test-case').create({
      data: {
        ...buildTestCaseData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
        functionality: functionalityDocumentId,
      } as any,
      populate: {
        organization: true,
        project: true,
        functionality: true,
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
      throw new errors.ValidationError('Test case documentId is required.');
    }

    const existing = await strapi.documents('api::test-case.test-case').findOne({
      documentId,
      populate: {
        organization: true,
        project: true,
        functionality: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Test case not found.');
    }

    const payload = (ctx.request.body?.data || {}) as TestCasePayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test case project is required.');
    }

    const functionalityDocumentId = await resolveFunctionalityDocumentId(
      payload.functionality,
      projectDocumentId,
      existing.functionality?.documentId ?? null,
    );

    if (!functionalityDocumentId) {
      throw new errors.ValidationError('Test case functionality is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await strapi.documents('api::test-case.test-case').update({
      documentId,
      data: {
        ...buildTestCaseData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
        functionality: functionalityDocumentId,
      } as any,
      populate: {
        organization: true,
        project: true,
        functionality: true,
      },
    });

    ctx.body = { data: updated };
  },
}));
