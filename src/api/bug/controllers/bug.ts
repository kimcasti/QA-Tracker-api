import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type BugPayload = {
  internalBugId?: string;
  externalBugId?: string | null;
  title?: string;
  description?: string | null;
  severity?: 'critical' | 'high' | 'medium' | 'low' | null;
  bugLink?: string | null;
  evidenceImage?: string | null;
  origin?: 'general_execution' | 'regression_cycle' | 'smoke_cycle';
  functionalityName?: string | null;
  moduleName?: string | null;
  detectedAt?: string | null;
  reportedBy?: string | null;
  status?: 'pending' | 'in_progress' | 'qa' | 'resolved';
  testCaseTitle?: string | null;
  linkedSourceId?: string | null;
  organization?: unknown;
  project?: unknown;
  functionality?: unknown;
  sprint?: unknown;
  testCase?: unknown;
  testRun?: unknown;
  testCycle?: unknown;
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

async function resolveOrganizationDocumentId(userId: number, payload: BugPayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::bug.bug',
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

    const functionalityByCode = await strapi
      .documents('api::functionality.functionality')
      .findFirst({
        filters: {
          code: requestedDocumentId,
          project: { documentId: projectDocumentId },
        },
      });

    if (functionalityByCode?.documentId) {
      return functionalityByCode.documentId;
    }
  }

  return fallbackDocumentId ?? null;
}

function buildBugData(
  payload: BugPayload,
  projectDocumentId: string,
  functionalityDocumentId?: string | null,
) {
  const data: Record<string, unknown> = {
    internalBugId: payload.internalBugId || '',
    externalBugId: payload.externalBugId || null,
    title: payload.title || '',
    description: payload.description || null,
    severity: payload.severity || null,
    bugLink: payload.bugLink || null,
    evidenceImage: payload.evidenceImage || null,
    origin: payload.origin || 'general_execution',
    functionalityName: payload.functionalityName || null,
    moduleName: payload.moduleName || null,
    detectedAt: payload.detectedAt || null,
    reportedBy: payload.reportedBy || null,
    status: payload.status || 'pending',
    testCaseTitle: payload.testCaseTitle || null,
    linkedSourceId: payload.linkedSourceId || null,
    project: projectDocumentId,
  };

  if (hasOwnProperty(payload, 'functionality')) {
    data.functionality = functionalityDocumentId;
  }

  if (hasOwnProperty(payload, 'sprint')) {
    data.sprint = extractRelationDocumentId(payload.sprint);
  }

  if (hasOwnProperty(payload, 'testCase')) {
    data.testCase = extractRelationDocumentId(payload.testCase);
  }

  if (hasOwnProperty(payload, 'testRun')) {
    data.testRun = extractRelationDocumentId(payload.testRun);
  }

  if (hasOwnProperty(payload, 'testCycle')) {
    data.testCycle = extractRelationDocumentId(payload.testCycle);
  }

  return data;
}

export default factories.createCoreController('api::bug.bug', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as BugPayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Bug project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);
    const functionalityDocumentId = await resolveFunctionalityDocumentId(
      payload.functionality,
      projectDocumentId,
    );

    const created = await strapi.documents('api::bug.bug').create({
      data: {
        ...buildBugData(payload, projectDocumentId, functionalityDocumentId),
        organization: organizationDocumentId,
      } as any,
      populate: {
        organization: true,
        project: true,
        functionality: true,
        sprint: true,
        testCase: true,
        testRun: true,
        testCycle: true,
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
      throw new errors.ValidationError('Bug documentId is required.');
    }

    const existing = await strapi.documents('api::bug.bug').findOne({
      documentId,
      populate: {
        organization: true,
        project: true,
        functionality: true,
        sprint: true,
        testCase: true,
        testRun: true,
        testCycle: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Bug not found.');
    }

    const payload = (ctx.request.body?.data || {}) as BugPayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Bug project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const functionalityDocumentId = await resolveFunctionalityDocumentId(
      payload.functionality,
      projectDocumentId,
      existing.functionality?.documentId ?? null,
    );

    const updated = await strapi.documents('api::bug.bug').update({
      documentId,
      data: {
        ...buildBugData(payload, projectDocumentId, functionalityDocumentId),
        organization: organizationDocumentId,
      } as any,
      populate: {
        organization: true,
        project: true,
        functionality: true,
        sprint: true,
        testCase: true,
        testRun: true,
        testCycle: true,
      },
    });

    ctx.body = { data: updated };
  },
}));
