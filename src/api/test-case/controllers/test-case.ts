import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { assertOrganizationLimitAvailable } from '../../../utils/plan-enforcement';
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

type TestCaseDocumentWithRelations = {
  documentId: string;
  project?: {
    documentId?: string;
  } | null;
  functionality?: {
    documentId?: string;
  } | null;
  organization?: {
    documentId?: string;
  } | null;
};

type TestCaseControllerDependencies = {
  assertOrganizationLimitAvailable: typeof assertOrganizationLimitAvailable;
  getUserMemberships: typeof getUserMemberships;
  getAllowedOrganizationDocumentIds: typeof getAllowedOrganizationDocumentIds;
  getOrganizationDocumentIdFromPayload: typeof getOrganizationDocumentIdFromPayload;
};

type CreateTestCaseControllerInput = {
  strapi: typeof globalThis.strapi;
  dependencies?: Partial<TestCaseControllerDependencies>;
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

const responsePopulate = {
  project: {
    fields: ['key'],
  },
  functionality: {
    fields: ['code'],
  },
};

async function resolveOrganizationDocumentId(
  input: CreateTestCaseControllerInput,
  userId: number,
  payload: TestCasePayload,
) {
  const dependencies = {
    getUserMemberships,
    getAllowedOrganizationDocumentIds,
    getOrganizationDocumentIdFromPayload,
    ...input.dependencies,
  };
  const memberships = await dependencies.getUserMemberships(input.strapi, userId);
  const allowedOrganizationDocumentIds = dependencies.getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await dependencies.getOrganizationDocumentIdFromPayload(
    input.strapi,
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
  strapiRef: typeof globalThis.strapi,
  rawFunctionality: unknown,
  projectDocumentId: string,
  fallbackDocumentId?: string | null,
) {
  const requestedDocumentId = extractRelationDocumentId(rawFunctionality);

  if (requestedDocumentId) {
    const functionalityByDocumentId = await strapiRef
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

    const functionalityByCode = await strapiRef.documents('api::functionality.functionality').findFirst({
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

export function createTestCaseController(input: CreateTestCaseControllerInput) {
  const dependencies = {
    assertOrganizationLimitAvailable,
    ...input.dependencies,
  };

  return {
  async find(this: any, ctx) {
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const query = {
      ...sanitizedQuery,
      // Avoid populating full project records here because large text/blob-like
      // project fields cause MySQL temp tables to overflow in production.
      populate: responsePopulate,
    };

    const { results, pagination } = await input.strapi.service('api::test-case.test-case').find(query);
    const sanitizedResults = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedResults, { pagination });
  },

  async findOne(this: any, ctx) {
    const documentId = ctx.params.documentId || ctx.params.id;

    if (!documentId) {
      throw new errors.ValidationError('Test case documentId is required.');
    }

    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const entity = await input.strapi.service('api::test-case.test-case').findOne(documentId, {
      ...sanitizedQuery,
      populate: responsePopulate,
    });
    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedEntity);
  },

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
      input.strapi,
      payload.functionality,
      projectDocumentId,
    );

    if (!functionalityDocumentId) {
      throw new errors.ValidationError('Test case functionality is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(input, userId, payload);
    await dependencies.assertOrganizationLimitAvailable({
      organizationDocumentId,
      limitKey: 'testCases',
      resourceLabel: 'casos de prueba',
    });

    const created = await input.strapi.documents('api::test-case.test-case').create({
      data: {
        ...buildTestCaseData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
        functionality: functionalityDocumentId,
      } as any,
      populate: responsePopulate as any,
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

    const existing = (await input.strapi.documents('api::test-case.test-case').findOne({
      documentId,
      populate: {
        project: {
          fields: ['key'],
        },
        functionality: {
          fields: ['code'],
        },
      } as any,
    })) as TestCaseDocumentWithRelations | null;

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
      input.strapi,
      payload.functionality,
      projectDocumentId,
      existing.functionality?.documentId ?? null,
    );

    if (!functionalityDocumentId) {
      throw new errors.ValidationError('Test case functionality is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(input, userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await input.strapi.documents('api::test-case.test-case').update({
      documentId,
      data: {
        ...buildTestCaseData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
        functionality: functionalityDocumentId,
      } as any,
      populate: responsePopulate as any,
    });

    ctx.body = { data: updated };
  },
  };
}

export default factories.createCoreController('api::test-case.test-case', () =>
  createTestCaseController({ strapi }),
);
