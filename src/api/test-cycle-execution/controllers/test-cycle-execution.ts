import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type TestCycleExecutionPayload = {
  moduleName?: string | null;
  functionalityName?: string | null;
  testCaseTitle?: string | null;
  executed?: boolean;
  date?: string | null;
  result?: 'passed' | 'failed' | 'blocked' | 'not_executed';
  executionMode?: 'manual' | 'automated' | null;
  evidence?: string | null;
  evidenceImage?: string | null;
  bugTitle?: string | null;
  bugLink?: string | null;
  severity?: 'critical' | 'high' | 'medium' | 'low' | null;
  linkedBugId?: string | null;
  organization?: unknown;
  project?: unknown;
  testCycle?: unknown;
  functionality?: unknown;
  testCase?: unknown;
  bug?: unknown;
  allowDestructiveReset?: boolean;
};

const testCyclePopulate = {
  organization: true,
  project: true,
  sprint: true,
  executions: {
    populate: {
      functionality: true,
      testCase: true,
      bug: true,
    },
  },
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

async function resolveOrganizationDocumentId(userId: number, payload: TestCycleExecutionPayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::test-cycle-execution.test-cycle-execution',
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

function buildTestCycleExecutionData(
  payload: TestCycleExecutionPayload,
  projectDocumentId: string,
  functionalityDocumentId?: string | null,
) {
  const data: Record<string, unknown> = {
    moduleName: payload.moduleName || null,
    functionalityName: payload.functionalityName || null,
    testCaseTitle: payload.testCaseTitle || null,
    executed: Boolean(payload.executed),
    date: payload.date || null,
    result: payload.result || 'not_executed',
    executionMode: payload.executionMode || 'manual',
    evidence: payload.evidence || null,
    evidenceImage: payload.evidenceImage || null,
    bugTitle: payload.bugTitle || null,
    bugLink: payload.bugLink || null,
    severity: payload.severity || null,
    linkedBugId: payload.linkedBugId || null,
    project: projectDocumentId,
  };

  if (hasOwnProperty(payload, 'testCycle')) {
    data.testCycle = extractRelationDocumentId(payload.testCycle);
  }

  if (hasOwnProperty(payload, 'functionality')) {
    data.functionality = functionalityDocumentId;
  }

  if (hasOwnProperty(payload, 'testCase')) {
    data.testCase = extractRelationDocumentId(payload.testCase);
  }

  if (hasOwnProperty(payload, 'bug')) {
    data.bug = extractRelationDocumentId(payload.bug);
  }

  return data;
}

function normalizeExecutionDate(value: unknown) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return null;
}

function hasTextContent(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDestructiveExecutionReset(
  existing: any,
  next: TestCycleExecutionPayload,
) {
  const existingExecuted = Boolean(existing.executed);
  const nextExecuted = Boolean(next.executed);
  const existingResult = existing.result || 'not_executed';
  const nextResult = next.result || 'not_executed';

  return (
    (existingExecuted && !nextExecuted) ||
    (existingResult !== 'not_executed' && nextResult === 'not_executed') ||
    (hasTextContent(existing.evidence) && !hasTextContent(next.evidence)) ||
    (hasTextContent(existing.evidenceImage) && !hasTextContent(next.evidenceImage)) ||
    (hasTextContent(existing.bugTitle) && !hasTextContent(next.bugTitle)) ||
    (hasTextContent(existing.linkedBugId) && !hasTextContent(next.linkedBugId))
  );
}

function calculateCycleStats(
  executions: Array<{
    executed?: boolean | null;
    result?: 'passed' | 'failed' | 'blocked' | 'not_executed' | null;
  }>,
) {
  const totalTests = executions.length;
  const passed = executions.filter(item => item.result === 'passed').length;
  const failed = executions.filter(item => item.result === 'failed').length;
  const blocked = executions.filter(item => item.result === 'blocked').length;
  const pending = executions.filter(item => !item.executed).length;
  const passRate = totalTests > 0 ? Math.round((passed / totalTests) * 1000) / 10 : 0;

  return {
    totalTests,
    passed,
    failed,
    blocked,
    pending,
    passRate,
  };
}

export default factories.createCoreController(
  'api::test-cycle-execution.test-cycle-execution',
  () => ({
    async create(ctx) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const payload = (ctx.request.body?.data || {}) as TestCycleExecutionPayload;
      const projectDocumentId = extractRelationDocumentId(payload.project);
      const testCycleDocumentId = extractRelationDocumentId(payload.testCycle);

      if (!projectDocumentId) {
        throw new errors.ValidationError('Test cycle execution project is required.');
      }

      if (!testCycleDocumentId) {
        throw new errors.ValidationError('Test cycle execution testCycle is required.');
      }

      const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);
      const functionalityDocumentId = await resolveFunctionalityDocumentId(
        payload.functionality,
        projectDocumentId,
      );

      const created = await strapi.documents('api::test-cycle-execution.test-cycle-execution').create({
        data: {
          ...buildTestCycleExecutionData(payload, projectDocumentId, functionalityDocumentId),
          organization: organizationDocumentId,
          testCycle: testCycleDocumentId,
        } as any,
        populate: {
          organization: true,
          project: true,
          testCycle: true,
          functionality: true,
          testCase: true,
          bug: true,
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
        throw new errors.ValidationError('Test cycle execution documentId is required.');
      }

      const existing = await strapi.documents('api::test-cycle-execution.test-cycle-execution').findOne({
        documentId,
        populate: {
          organization: true,
          project: true,
          testCycle: true,
          functionality: true,
          testCase: true,
          bug: true,
        },
      });

      if (!existing) {
        throw new errors.NotFoundError('Test cycle execution not found.');
      }

      const payload = (ctx.request.body?.data || {}) as TestCycleExecutionPayload;
      const projectDocumentId =
        extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;
      const testCycleDocumentId =
        extractRelationDocumentId(payload.testCycle) ?? existing.testCycle?.documentId ?? null;

      if (!projectDocumentId) {
        throw new errors.ValidationError('Test cycle execution project is required.');
      }

      if (!testCycleDocumentId) {
        throw new errors.ValidationError('Test cycle execution testCycle is required.');
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

      const updated = await strapi.documents('api::test-cycle-execution.test-cycle-execution').update({
        documentId,
        data: {
          ...buildTestCycleExecutionData(payload, projectDocumentId, functionalityDocumentId),
          organization: organizationDocumentId,
          testCycle: testCycleDocumentId,
        } as any,
        populate: {
          organization: true,
          project: true,
          testCycle: true,
          functionality: true,
          testCase: true,
          bug: true,
        },
      });

      ctx.body = { data: updated };
    },

    async persist(ctx) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const documentId = ctx.params.documentId || ctx.params.id;
      if (!documentId) {
        throw new errors.ValidationError('Test cycle execution documentId is required.');
      }

      const existing = await strapi.documents('api::test-cycle-execution.test-cycle-execution').findOne({
        documentId,
        populate: {
          organization: true,
          project: true,
          testCycle: true,
          functionality: true,
          testCase: true,
          bug: true,
        },
      });

      if (!existing) {
        throw new errors.NotFoundError('Test cycle execution not found.');
      }

      const payload = (ctx.request.body?.data || {}) as TestCycleExecutionPayload;
      const projectDocumentId = existing.project?.documentId ?? null;
      const testCycleDocumentId = existing.testCycle?.documentId ?? null;

      if (!projectDocumentId) {
        throw new errors.ValidationError('Test cycle execution project is required.');
      }

      if (!testCycleDocumentId) {
        throw new errors.ValidationError('Test cycle execution testCycle is required.');
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

      const mergedPayload: TestCycleExecutionPayload = {
        moduleName: hasOwnProperty(payload, 'moduleName')
          ? payload.moduleName
          : existing.moduleName ?? null,
        functionalityName: hasOwnProperty(payload, 'functionalityName')
          ? payload.functionalityName
          : existing.functionalityName ?? null,
        testCaseTitle: hasOwnProperty(payload, 'testCaseTitle')
          ? payload.testCaseTitle
          : existing.testCaseTitle ?? null,
        executed: hasOwnProperty(payload, 'executed')
          ? payload.executed
          : Boolean(existing.executed),
        date: hasOwnProperty(payload, 'date')
          ? payload.date
          : normalizeExecutionDate(existing.date),
        result: hasOwnProperty(payload, 'result') ? payload.result : existing.result ?? 'not_executed',
        executionMode: hasOwnProperty(payload, 'executionMode')
          ? payload.executionMode
          : existing.executionMode ?? 'manual',
        evidence: hasOwnProperty(payload, 'evidence') ? payload.evidence : existing.evidence ?? null,
        evidenceImage: hasOwnProperty(payload, 'evidenceImage')
          ? payload.evidenceImage
          : existing.evidenceImage ?? null,
        bugTitle: hasOwnProperty(payload, 'bugTitle')
          ? payload.bugTitle
          : existing.bugTitle ?? null,
        bugLink: hasOwnProperty(payload, 'bugLink') ? payload.bugLink : existing.bugLink ?? null,
        severity: hasOwnProperty(payload, 'severity')
          ? payload.severity
          : existing.severity ?? null,
        linkedBugId: hasOwnProperty(payload, 'linkedBugId')
          ? payload.linkedBugId
          : existing.linkedBugId ?? null,
        organization: organizationDocumentId,
        project: projectDocumentId,
        testCycle: testCycleDocumentId,
        functionality: hasOwnProperty(payload, 'functionality')
          ? payload.functionality
          : existing.functionality?.documentId ?? null,
        testCase: hasOwnProperty(payload, 'testCase')
          ? payload.testCase
          : existing.testCase?.documentId ?? null,
        bug: hasOwnProperty(payload, 'bug') ? payload.bug : existing.bug?.documentId ?? null,
      };

      if (!payload.allowDestructiveReset && isDestructiveExecutionReset(existing, mergedPayload)) {
        throw new errors.ValidationError(
          'This execution already contains progress. Refresh the cycle before making destructive changes.',
        );
      }

      await strapi.documents('api::test-cycle-execution.test-cycle-execution').update({
        documentId,
        data: {
          ...buildTestCycleExecutionData(mergedPayload, projectDocumentId, functionalityDocumentId),
          organization: organizationDocumentId,
          testCycle: testCycleDocumentId,
        } as any,
        populate: {
          organization: true,
          project: true,
          testCycle: true,
          functionality: true,
          testCase: true,
          bug: true,
        },
      });

      const refreshedCycle = await strapi.documents('api::test-cycle.test-cycle').findOne({
        documentId: testCycleDocumentId,
        populate: testCyclePopulate,
      });

      if (!refreshedCycle) {
        throw new errors.NotFoundError('Test cycle not found.');
      }

      const stats = calculateCycleStats(refreshedCycle.executions || []);

      const updatedCycle = await strapi.documents('api::test-cycle.test-cycle').update({
        documentId: testCycleDocumentId,
        data: {
          code: refreshedCycle.code,
          cycleType: refreshedCycle.cycleType,
          date: refreshedCycle.date,
          totalTests: stats.totalTests,
          passed: stats.passed,
          failed: stats.failed,
          blocked: stats.blocked,
          pending: stats.pending,
          passRate: stats.passRate,
          note: refreshedCycle.note || null,
          status: refreshedCycle.status || 'in_progress',
          tester: refreshedCycle.tester || null,
          buildVersion: refreshedCycle.buildVersion || null,
          environment: refreshedCycle.environment || null,
          organization: refreshedCycle.organization?.documentId || organizationDocumentId,
          project: refreshedCycle.project?.documentId || projectDocumentId,
          sprint: refreshedCycle.sprint?.documentId || null,
        } as any,
        populate: testCyclePopulate,
      });

      ctx.body = { data: updatedCycle };
    },
  }),
);
