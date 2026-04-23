import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { ADMIN_ROLES, OWNER_ROLES } from '../../../utils/access';
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

function normalizeComparableString(value?: string | null) {
  return (value || '').trim() || null;
}

function normalizeComparableDate(value?: string | null) {
  return normalizeComparableString(value);
}

const summaryFields = [
  'documentId',
  'code',
  'cycleType',
  'date',
  'totalTests',
  'passed',
  'failed',
  'blocked',
  'pending',
  'passRate',
  'note',
  'status',
  'tester',
  'buildVersion',
  'environment',
] as const;

const summaryPopulate = {
  project: {
    fields: ['key'],
  },
  sprint: {
    fields: ['name'],
  },
};

function hasCycleConfigurationChanges(
  payload: TestCyclePayload,
  existing: any,
  nextSprintDocumentId?: string | null,
) {
  const nextCode = normalizeComparableString(payload.code ?? existing.code);
  const nextDate = normalizeComparableDate(payload.date ?? existing.date);
  const nextNote = normalizeComparableString(payload.note ?? existing.note);
  const nextTester = normalizeComparableString(payload.tester ?? existing.tester);
  const nextBuildVersion = normalizeComparableString(
    payload.buildVersion ?? existing.buildVersion,
  );
  const nextEnvironment = normalizeComparableString(
    payload.environment ?? existing.environment,
  );
  const nextSprint = normalizeComparableString(
    nextSprintDocumentId ?? existing.sprint?.documentId,
  );

  return (
    nextCode !== normalizeComparableString(existing.code) ||
    nextDate !== normalizeComparableDate(existing.date) ||
    nextNote !== normalizeComparableString(existing.note) ||
    nextTester !== normalizeComparableString(existing.tester) ||
    nextBuildVersion !== normalizeComparableString(existing.buildVersion) ||
    nextEnvironment !== normalizeComparableString(existing.environment) ||
    nextSprint !== normalizeComparableString(existing.sprint?.documentId)
  );
}

function isCycleReopen(payload: TestCyclePayload, existing: any) {
  const nextStatus = payload.status ?? existing.status;
  return existing.status === 'completed' && nextStatus === 'in_progress';
}

function isCycleFinalize(payload: TestCyclePayload, existing: any) {
  const nextStatus = payload.status ?? existing.status;
  return existing.status !== 'completed' && nextStatus === 'completed';
}

async function ensureCycleAdminAccess(
  userId: number,
  organizationDocumentId?: string | null,
) {
  if (!organizationDocumentId) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const memberships = await getUserMemberships(strapi, userId);
  const membership = memberships.find(
    item => item.organization?.documentId === organizationDocumentId,
  );

  if (!membership || !ADMIN_ROLES.includes((membership.organizationRole?.code || '') as any)) {
    throw new errors.ForbiddenError(
      'Only Owner or QA Lead can edit or reopen regression and smoke cycles.',
    );
  }
}

async function ensureCycleOwnerAccess(
  userId: number,
  organizationDocumentId?: string | null,
) {
  if (!organizationDocumentId) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const memberships = await getUserMemberships(strapi, userId);
  const membership = memberships.find(
    item => item.organization?.documentId === organizationDocumentId,
  );

  if (!membership || !OWNER_ROLES.includes((membership.organizationRole?.code || '') as any)) {
    throw new errors.ForbiddenError('Only Owner can finalize regression and smoke cycles.');
  }
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

async function findDuplicateCycle(
  projectDocumentId: string,
  code: string,
  excludeDocumentId?: string,
) {
  const matches = await strapi.documents('api::test-cycle.test-cycle').findMany({
    filters: {
      code: { $eq: code },
      project: { documentId: { $eq: projectDocumentId } },
    } as any,
    fields: ['documentId', 'code'],
  });

  return matches.find(item => item.documentId !== excludeDocumentId) || null;
}

export default factories.createCoreController('api::test-cycle.test-cycle', () => ({
  async listSummary(ctx) {
    await this.validateQuery(ctx);
    const sanitizedQuery = await this.sanitizeQuery(ctx);
    const query = {
      ...sanitizedQuery,
      fields: summaryFields,
      populate: summaryPopulate,
    };

    const { results, pagination } = await strapi.service('api::test-cycle.test-cycle').find(query);
    const sanitizedResults = await this.sanitizeOutput(results, ctx);
    return this.transformResponse(sanitizedResults, { pagination });
  },

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

    const cycleCode = payload.code?.trim();
    if (!cycleCode) {
      throw new errors.ValidationError('Test cycle code is required.');
    }

    const duplicateCycle = await findDuplicateCycle(projectDocumentId, cycleCode);
    if (duplicateCycle) {
      throw new errors.ValidationError(
        `A test cycle with code "${cycleCode}" already exists in this project.`,
      );
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

    const created = await strapi.documents('api::test-cycle.test-cycle').create({
      data: {
        ...buildTestCycleData({ ...payload, code: cycleCode }),
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
    const sprintDocumentId =
      extractRelationDocumentId(payload.sprint) ?? existing.sprint?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test cycle project is required.');
    }

    const cycleCode = payload.code?.trim() || existing.code?.trim();
    if (!cycleCode) {
      throw new errors.ValidationError('Test cycle code is required.');
    }

    const duplicateCycle = await findDuplicateCycle(
      projectDocumentId,
      cycleCode,
      existing.documentId,
    );
    if (duplicateCycle) {
      throw new errors.ValidationError(
        `A test cycle with code "${cycleCode}" already exists in this project.`,
      );
    }

    if (isCycleFinalize(payload, existing)) {
      await ensureCycleOwnerAccess(userId, existing.organization?.documentId);
    }

    if (
      hasCycleConfigurationChanges(payload, existing, sprintDocumentId) ||
      isCycleReopen(payload, existing)
    ) {
      await ensureCycleAdminAccess(userId, existing.organization?.documentId);
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await strapi.documents('api::test-cycle.test-cycle').update({
      documentId,
      data: {
        ...buildTestCycleData({ ...payload, code: cycleCode }),
        organization: organizationDocumentId,
        project: projectDocumentId,
        sprint: sprintDocumentId,
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
