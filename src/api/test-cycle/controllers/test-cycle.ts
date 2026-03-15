import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type TestCyclePayload = {
  code?: string;
  cycleType?: 'regression' | 'smoke';
  date?: string | null;
  totalTests?: number;
  passed?: number;
  failed?: number;
  blocked?: number;
  pending?: number;
  passRate?: number;
  note?: string | null;
  status?: 'completed' | 'in_progress';
  tester?: string | null;
  buildVersion?: string | null;
  environment?: 'test' | 'local' | 'production' | null;
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

function buildTestCycleData(payload: TestCyclePayload) {
  const data: Record<string, unknown> = {
    code: payload.code || '',
    cycleType: payload.cycleType || 'regression',
    date: payload.date || null,
    totalTests: payload.totalTests ?? 0,
    passed: payload.passed ?? 0,
    failed: payload.failed ?? 0,
    blocked: payload.blocked ?? 0,
    pending: payload.pending ?? 0,
    passRate: payload.passRate ?? 0,
    note: payload.note || null,
    status: payload.status || 'in_progress',
    tester: payload.tester || null,
    buildVersion: payload.buildVersion || null,
    environment: payload.environment || null,
  };

  if (hasOwnProperty(payload, 'sprint')) {
    data.sprint = extractRelationDocumentId(payload.sprint);
  }

  return data;
}

async function resolveOrganizationDocumentId(userId: number, payload: TestCyclePayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::test-cycle.test-cycle',
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

export default factories.createCoreController('api::test-cycle.test-cycle', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as TestCyclePayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test cycle project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

    const created = await strapi.documents('api::test-cycle.test-cycle').create({
      data: {
        ...buildTestCycleData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
      } as any,
      populate: {
        organization: true,
        project: true,
        sprint: true,
        executions: true,
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
      throw new errors.ValidationError('Test cycle documentId is required.');
    }

    const existing = await strapi.documents('api::test-cycle.test-cycle').findOne({
      documentId,
      populate: {
        organization: true,
        project: true,
        sprint: true,
        executions: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Test cycle not found.');
    }

    const payload = (ctx.request.body?.data || {}) as TestCyclePayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test cycle project is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await strapi.documents('api::test-cycle.test-cycle').update({
      documentId,
      data: {
        ...buildTestCycleData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
      } as any,
      populate: {
        organization: true,
        project: true,
        sprint: true,
        executions: true,
      },
    });

    ctx.body = { data: updated };
  },
}));
