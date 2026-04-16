import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { ADMIN_ROLES } from '../../../utils/access';
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
  assignedTesterName?: string | null;
  assignedTesterEmail?: string | null;
  expectedUpdatedAt?: string | null;
  organization?: unknown;
  project?: unknown;
  testCycle?: unknown;
  functionality?: unknown;
  testCase?: unknown;
  bug?: unknown;
  allowDestructiveReset?: boolean;
};

type BatchExecutionSyncItem = {
  documentId?: string | null;
  data?: TestCycleExecutionPayload | null;
};

type BatchExecutionSyncPayload = {
  testCycle?: unknown;
  project?: unknown;
  organization?: unknown;
  items?: BatchExecutionSyncItem[] | null;
};

type SlackDirectoryMember = {
  email?: string | null;
  username?: string | null;
  fullName?: string | null;
  realName?: string | null;
  displayName?: string | null;
};

type ExecutionAccessContext = {
  roleCode: string;
  userEmail: string | null;
  identityKeys: string[];
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

function normalizeComparableValue(value?: string | null) {
  return (value || '').trim().toLowerCase();
}

function normalizeEmail(value?: string | null) {
  const normalized = normalizeComparableValue(value);
  return normalized || null;
}

function addComparableIdentity(target: Set<string>, value?: string | null) {
  const normalized = normalizeComparableValue(value);
  if (normalized) {
    target.add(normalized);
  }
}

function addEmailIdentity(target: Set<string>, value?: string | null) {
  const normalized = normalizeEmail(value);
  if (!normalized) return;

  target.add(normalized);
  const [localPart] = normalized.split('@');
  if (localPart) {
    target.add(localPart);
  }
}

async function resolveSlackMemberForUser(
  userEmail?: string | null,
  userUsername?: string | null,
) {
  const normalizedEmail = normalizeEmail(userEmail);
  const normalizedUsername = normalizeComparableValue(userUsername);

  if (!normalizedEmail && !normalizedUsername) {
    return null;
  }

  try {
    const members = (await strapi.service('api::slack.slack').members()) as SlackDirectoryMember[];

    return (
      members.find(member => {
        const memberEmail = normalizeEmail(member.email);
        const memberUsername = normalizeComparableValue(member.username);
        const memberFullName = normalizeComparableValue(member.fullName);
        const memberDisplayName = normalizeComparableValue(member.displayName);
        const memberRealName = normalizeComparableValue(member.realName);

        return (
          (normalizedEmail && memberEmail === normalizedEmail) ||
          (normalizedUsername &&
            (memberUsername === normalizedUsername ||
              memberFullName === normalizedUsername ||
              memberDisplayName === normalizedUsername ||
              memberRealName === normalizedUsername))
        );
      }) || null
    );
  } catch (error) {
    strapi.log.warn('Unable to resolve Slack member for execution access checks.');
    return null;
  }
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
    assignedTesterName: payload.assignedTesterName || null,
    assignedTesterEmail: normalizeEmail(payload.assignedTesterEmail),
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

function buildExecutionIdentity(source: {
  moduleName?: string | null;
  functionalityName?: string | null;
  functionalityDocumentId?: string | null;
  functionalityCode?: string | null;
  testCaseDocumentId?: string | null;
  testCaseTitle?: string | null;
}) {
  const moduleKey = normalizeComparableValue(source.moduleName) || '__module__';
  const functionalityKey =
    normalizeComparableValue(source.functionalityDocumentId) ||
    normalizeComparableValue(source.functionalityCode) ||
    normalizeComparableValue(source.functionalityName) ||
    '__functionality__';
  const testCaseKey =
    normalizeComparableValue(source.testCaseDocumentId) ||
    normalizeComparableValue(source.testCaseTitle) ||
    '__functionality_execution__';

  return `${moduleKey}::${functionalityKey}::${testCaseKey}`;
}

function executionProgressScore(source: any) {
  let score = 0;

  if (source.executed) score += 4;
  if (source.result && source.result !== 'not_executed') score += 4;
  if (hasTextContent(source.date)) score += 1;
  if (hasTextContent(source.evidence)) score += 3;
  if (hasTextContent(source.evidenceImage)) score += 3;
  if (hasTextContent(source.bugTitle)) score += 2;
  if (hasTextContent(source.bugLink)) score += 1;
  if (source.severity) score += 1;
  if (hasTextContent(source.linkedBugId)) score += 1;

  return score;
}

function compareIsoDate(left?: string | null, right?: string | null) {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;

  if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
  if (!Number.isFinite(leftTime)) return -1;
  if (!Number.isFinite(rightTime)) return 1;
  return leftTime - rightTime;
}

function selectBestExecution(group: any[]) {
  return [...group].sort((left, right) => {
    const scoreDifference = executionProgressScore(right) - executionProgressScore(left);
    if (scoreDifference !== 0) return scoreDifference;
    return compareIsoDate(right.updatedAt, left.updatedAt);
  })[0];
}

function mergeExecutionGroup(group: any[]) {
  const bestExecution = selectBestExecution(group);

  return group.reduce(
    (merged, candidate) => ({
      ...merged,
      moduleName: merged.moduleName || candidate.moduleName || null,
      functionalityName: merged.functionalityName || candidate.functionalityName || null,
      testCaseTitle: merged.testCaseTitle || candidate.testCaseTitle || null,
      executed: Boolean(merged.executed || candidate.executed),
      date: merged.date || normalizeExecutionDate(candidate.date),
      result:
        merged.result && merged.result !== 'not_executed'
          ? merged.result
          : candidate.result || 'not_executed',
      executionMode: merged.executionMode || candidate.executionMode || 'manual',
      evidence: merged.evidence || candidate.evidence || null,
      evidenceImage: merged.evidenceImage || candidate.evidenceImage || null,
      bugTitle: merged.bugTitle || candidate.bugTitle || null,
      bugLink: merged.bugLink || candidate.bugLink || null,
      severity: merged.severity || candidate.severity || null,
      linkedBugId: merged.linkedBugId || candidate.linkedBugId || null,
      assignedTesterName: merged.assignedTesterName || candidate.assignedTesterName || null,
      assignedTesterEmail:
        normalizeEmail(merged.assignedTesterEmail) ||
        normalizeEmail(candidate.assignedTesterEmail),
      organization: merged.organization || candidate.organization,
      project: merged.project || candidate.project,
      testCycle: merged.testCycle || candidate.testCycle,
      functionality: merged.functionality || candidate.functionality,
      testCase: merged.testCase || candidate.testCase,
      bug: merged.bug || candidate.bug,
      updatedAt:
        compareIsoDate(merged.updatedAt, candidate.updatedAt) >= 0
          ? merged.updatedAt
          : candidate.updatedAt,
    }),
    { ...bestExecution },
  );
}

function buildExecutionDocumentData(source: any) {
  return {
    moduleName: source.moduleName || null,
    functionalityName: source.functionalityName || null,
    testCaseTitle: source.testCaseTitle || null,
    executed: Boolean(source.executed),
    date: normalizeExecutionDate(source.date),
    result: source.result || 'not_executed',
    executionMode: source.executionMode || 'manual',
    evidence: source.evidence || null,
    evidenceImage: source.evidenceImage || null,
    bugTitle: source.bugTitle || null,
    bugLink: source.bugLink || null,
    severity: source.severity || null,
    linkedBugId: source.linkedBugId || null,
    assignedTesterName: source.assignedTesterName || null,
    assignedTesterEmail: normalizeEmail(source.assignedTesterEmail),
    organization: source.organization?.documentId || null,
    project: source.project?.documentId || null,
    testCycle: source.testCycle?.documentId || null,
    functionality: source.functionality?.documentId || null,
    testCase: source.testCase?.documentId || null,
    bug: source.bug?.documentId || null,
  };
}

async function getCycleExecutions(testCycleDocumentId: string) {
  return (await strapi.documents('api::test-cycle-execution.test-cycle-execution').findMany({
    filters: {
      testCycle: { documentId: testCycleDocumentId },
    },
    populate: {
      organization: true,
      project: true,
      testCycle: true,
      functionality: true,
      testCase: true,
      bug: true,
    },
    sort: ['updatedAt:desc'],
  })) as any[];
}

async function findDuplicateExecution(
  testCycleDocumentId: string,
  identity: string,
  excludeDocumentId?: string,
) {
  const executions = await getCycleExecutions(testCycleDocumentId);

  return (
    executions.find(item => {
      const itemIdentity = buildExecutionIdentity({
        moduleName: item.moduleName,
        functionalityName: item.functionalityName,
        functionalityDocumentId: item.functionality?.documentId,
        functionalityCode: item.functionality?.code,
        testCaseDocumentId: item.testCase?.documentId,
        testCaseTitle: item.testCase?.title || item.testCaseTitle,
      });

      return itemIdentity === identity && item.documentId !== excludeDocumentId;
    }) || null
  );
}

async function dedupeCycleExecutions(
  testCycleDocumentId: string,
  preferredDocumentId?: string,
) {
  const executions = await getCycleExecutions(testCycleDocumentId);
  const groups = new Map<string, any[]>();

  executions.forEach(item => {
    const identity = buildExecutionIdentity({
      moduleName: item.moduleName,
      functionalityName: item.functionalityName,
      functionalityDocumentId: item.functionality?.documentId,
      functionalityCode: item.functionality?.code,
      testCaseDocumentId: item.testCase?.documentId,
      testCaseTitle: item.testCase?.title || item.testCaseTitle,
    });

    const group = groups.get(identity) || [];
    group.push(item);
    groups.set(identity, group);
  });

  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    const merged = mergeExecutionGroup(group);
    const canonical =
      group.find(item => item.documentId === preferredDocumentId) || selectBestExecution(group);

    await strapi.documents('api::test-cycle-execution.test-cycle-execution').update({
      documentId: canonical.documentId,
      data: buildExecutionDocumentData({
        ...merged,
        organization: canonical.organization || merged.organization,
        project: canonical.project || merged.project,
        testCycle: canonical.testCycle || merged.testCycle,
        functionality: canonical.functionality || merged.functionality,
        testCase: canonical.testCase || merged.testCase,
        bug: canonical.bug || merged.bug,
      }) as any,
      populate: {
        organization: true,
        project: true,
        testCycle: true,
        functionality: true,
        testCase: true,
        bug: true,
      },
    });

    for (const duplicate of group) {
      if (duplicate.documentId === canonical.documentId) continue;

      await strapi.documents('api::test-cycle-execution.test-cycle-execution').delete({
        documentId: duplicate.documentId,
      });
    }
  }

  return getCycleExecutions(testCycleDocumentId);
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

async function syncCycleStats(
  testCycleDocumentId: string,
  organizationDocumentId: string,
  projectDocumentId: string,
  preferredDocumentId?: string,
) {
  const dedupedExecutions = await dedupeCycleExecutions(testCycleDocumentId, preferredDocumentId);
  const refreshedCycle = await strapi.documents('api::test-cycle.test-cycle').findOne({
    documentId: testCycleDocumentId,
    populate: testCyclePopulate,
  });

  if (!refreshedCycle) {
    throw new errors.NotFoundError('Test cycle not found.');
  }

  const stats = calculateCycleStats(dedupedExecutions || []);

  return strapi.documents('api::test-cycle.test-cycle').update({
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
}

async function getCurrentExecutionAccessContext(
  userId: number,
  organizationDocumentId?: string | null,
  assignedTesterName?: string | null,
) {
  const memberships = await getUserMemberships(strapi, userId);
  const membership = memberships.find(
    item => item.organization?.documentId === organizationDocumentId,
  );
  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
  });
  const identityKeys = new Set<string>();

  addEmailIdentity(identityKeys, user?.email);
  addComparableIdentity(identityKeys, user?.username);

  if (normalizeComparableValue(assignedTesterName)) {
    const slackMember = await resolveSlackMemberForUser(user?.email, user?.username);
    addEmailIdentity(identityKeys, slackMember?.email);
    addComparableIdentity(identityKeys, slackMember?.username);
    addComparableIdentity(identityKeys, slackMember?.fullName);
    addComparableIdentity(identityKeys, slackMember?.displayName);
    addComparableIdentity(identityKeys, slackMember?.realName);
  }

  return {
    roleCode: membership?.organizationRole?.code || '',
    userEmail: normalizeEmail(user?.email),
    identityKeys: [...identityKeys],
  };
}

function assertExecutionAssignmentAccess(
  existing: any,
  accessContext: ExecutionAccessContext,
) {
  const assignedTesterEmail = normalizeEmail(existing.assignedTesterEmail);
  const assignedTesterName = normalizeComparableValue(existing.assignedTesterName);
  const identityKeys = new Set(accessContext.identityKeys);

  if (!assignedTesterEmail && !assignedTesterName) return;
  if (ADMIN_ROLES.includes(accessContext.roleCode as any)) return;
  if (assignedTesterEmail && identityKeys.has(assignedTesterEmail)) return;
  if (assignedTesterName && identityKeys.has(assignedTesterName)) return;

  throw new errors.ForbiddenError(
    'This execution is assigned to another tester. Refresh the cycle to see the latest assignment.',
  );
}

function assertExpectedVersion(existing: any, payload: TestCycleExecutionPayload) {
  if (!payload.expectedUpdatedAt) return;

  if (
    normalizeComparableValue(existing.updatedAt) !==
    normalizeComparableValue(payload.expectedUpdatedAt)
  ) {
    throw new errors.ValidationError(
      'This execution was updated by another tester. Refresh the cycle before saving again.',
    );
  }
}

function isDestructiveExecutionReset(existing: any, next: TestCycleExecutionPayload) {
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

function mergeExecutionPayloadWithExisting(
  existing: any,
  payload: TestCycleExecutionPayload,
  organizationDocumentId: string,
  projectDocumentId: string,
  testCycleDocumentId: string,
) {
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
    assignedTesterName: hasOwnProperty(payload, 'assignedTesterName')
      ? payload.assignedTesterName
      : existing.assignedTesterName ?? null,
    assignedTesterEmail: hasOwnProperty(payload, 'assignedTesterEmail')
      ? payload.assignedTesterEmail
      : existing.assignedTesterEmail ?? null,
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

  if (isDestructiveExecutionReset(existing, mergedPayload)) {
    return {
      ...mergedPayload,
      executed: Boolean(existing.executed),
      date: normalizeExecutionDate(existing.date),
      result: existing.result ?? 'not_executed',
      evidence: existing.evidence ?? null,
      evidenceImage: existing.evidenceImage ?? null,
      bugTitle: existing.bugTitle ?? null,
      bugLink: existing.bugLink ?? null,
      severity: existing.severity ?? null,
      linkedBugId: existing.linkedBugId ?? null,
    } satisfies TestCycleExecutionPayload;
  }

  return mergedPayload;
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
      const identity = buildExecutionIdentity({
        moduleName: payload.moduleName,
        functionalityName: payload.functionalityName,
        functionalityDocumentId,
        testCaseDocumentId: extractRelationDocumentId(payload.testCase),
        testCaseTitle: payload.testCaseTitle,
      });
      const duplicate = await findDuplicateExecution(testCycleDocumentId, identity);

      if (duplicate) {
        await dedupeCycleExecutions(testCycleDocumentId, duplicate.documentId);
        const accessContext = await getCurrentExecutionAccessContext(
          userId,
          duplicate.organization?.documentId ?? organizationDocumentId,
          duplicate.assignedTesterName,
        );
        assertExecutionAssignmentAccess(duplicate, accessContext);
        const safePayload = mergeExecutionPayloadWithExisting(
          duplicate,
          payload,
          organizationDocumentId,
          projectDocumentId,
          testCycleDocumentId,
        );

        const updated = await strapi.documents('api::test-cycle-execution.test-cycle-execution').update({
          documentId: duplicate.documentId,
          data: {
            ...buildTestCycleExecutionData(safePayload, projectDocumentId, functionalityDocumentId),
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
        return;
      }

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

      let existing = await strapi.documents('api::test-cycle-execution.test-cycle-execution').findOne({
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

      if (existing.testCycle?.documentId) {
        await dedupeCycleExecutions(existing.testCycle.documentId, existing.documentId);
        existing = await strapi.documents('api::test-cycle-execution.test-cycle-execution').findOne({
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
      }

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
      const accessContext = await getCurrentExecutionAccessContext(
        userId,
        existing.organization?.documentId ?? organizationDocumentId,
        existing.assignedTesterName,
      );
      assertExecutionAssignmentAccess(existing, accessContext);

      const functionalityDocumentId = await resolveFunctionalityDocumentId(
        payload.functionality,
        projectDocumentId,
        existing.functionality?.documentId ?? null,
      );

      const duplicate = await findDuplicateExecution(
        testCycleDocumentId,
        buildExecutionIdentity({
          moduleName: payload.moduleName ?? existing.moduleName,
          functionalityName: payload.functionalityName ?? existing.functionalityName,
          functionalityDocumentId,
          testCaseDocumentId:
            extractRelationDocumentId(payload.testCase) ?? existing.testCase?.documentId ?? null,
          testCaseTitle: payload.testCaseTitle ?? existing.testCaseTitle,
        }),
        existing.documentId,
      );

      if (duplicate) {
        await dedupeCycleExecutions(testCycleDocumentId, existing.documentId);
      }
      const safePayload = mergeExecutionPayloadWithExisting(
        existing,
        payload,
        organizationDocumentId,
        projectDocumentId,
        testCycleDocumentId,
      );

      const updated = await strapi.documents('api::test-cycle-execution.test-cycle-execution').update({
        documentId,
        data: {
          ...buildTestCycleExecutionData(safePayload, projectDocumentId, functionalityDocumentId),
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

    async batchSync(ctx) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const payload = (ctx.request.body?.data || {}) as BatchExecutionSyncPayload;
      const testCycleDocumentId = extractRelationDocumentId(payload.testCycle);
      const requestedProjectDocumentId = extractRelationDocumentId(payload.project);
      const requestedOrganizationDocumentId = extractRelationDocumentId(payload.organization);
      const items = Array.isArray(payload.items) ? payload.items : [];

      if (!testCycleDocumentId) {
        throw new errors.ValidationError('Test cycle execution testCycle is required.');
      }

      const testCycle = await strapi.documents('api::test-cycle.test-cycle').findOne({
        documentId: testCycleDocumentId,
        populate: {
          organization: true,
          project: true,
        },
      });

      if (!testCycle) {
        throw new errors.NotFoundError('Test cycle not found.');
      }

      const projectDocumentId = requestedProjectDocumentId ?? testCycle.project?.documentId ?? null;

      if (!projectDocumentId) {
        throw new errors.ValidationError('Test cycle execution project is required.');
      }

      const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
        project: projectDocumentId,
        organization: requestedOrganizationDocumentId ?? testCycle.organization?.documentId ?? null,
      });

      const dedupedExecutions = await dedupeCycleExecutions(testCycleDocumentId);
      const existingExecutionsByDocumentId = new Map(
        dedupedExecutions.map(item => [item.documentId, item]),
      );
      const existingExecutionsByIdentity = new Map(
        dedupedExecutions.map(item => [
          buildExecutionIdentity({
            moduleName: item.moduleName,
            functionalityName: item.functionalityName,
            functionalityDocumentId: item.functionality?.documentId,
            functionalityCode: item.functionality?.code,
            testCaseDocumentId: item.testCase?.documentId,
            testCaseTitle: item.testCase?.title || item.testCaseTitle,
          }),
          item,
        ]),
      );

      const savedExecutionIds = new Set<string>();

      for (const item of items) {
        const executionPayload = (item?.data || {}) as TestCycleExecutionPayload;
        const functionalityDocumentId = await resolveFunctionalityDocumentId(
          executionPayload.functionality,
          projectDocumentId,
        );
        const executionIdentity = buildExecutionIdentity({
          moduleName: executionPayload.moduleName,
          functionalityName: executionPayload.functionalityName,
          functionalityDocumentId,
          testCaseDocumentId: extractRelationDocumentId(executionPayload.testCase),
          testCaseTitle: executionPayload.testCaseTitle,
        });

        const existingExecution =
          (item?.documentId
            ? existingExecutionsByDocumentId.get(item.documentId)
            : undefined) || existingExecutionsByIdentity.get(executionIdentity);

        if (existingExecution) {
          const accessContext = await getCurrentExecutionAccessContext(
            userId,
            existingExecution.organization?.documentId ?? organizationDocumentId,
            existingExecution.assignedTesterName,
          );
          assertExecutionAssignmentAccess(existingExecution, accessContext);

          const safePayload = mergeExecutionPayloadWithExisting(
            existingExecution,
            executionPayload,
            organizationDocumentId,
            projectDocumentId,
            testCycleDocumentId,
          );

          const updated = await strapi.documents(
            'api::test-cycle-execution.test-cycle-execution',
          ).update({
            documentId: existingExecution.documentId,
            data: {
              ...buildTestCycleExecutionData(safePayload, projectDocumentId, functionalityDocumentId),
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

          savedExecutionIds.add(updated.documentId);
          existingExecutionsByDocumentId.set(updated.documentId, updated);
          existingExecutionsByIdentity.set(executionIdentity, updated);
          continue;
        }

        const created = await strapi.documents(
          'api::test-cycle-execution.test-cycle-execution',
        ).create({
          data: {
            ...buildTestCycleExecutionData(executionPayload, projectDocumentId, functionalityDocumentId),
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

        savedExecutionIds.add(created.documentId);
        existingExecutionsByDocumentId.set(created.documentId, created);
        existingExecutionsByIdentity.set(executionIdentity, created);
      }

      await Promise.all(
        dedupedExecutions
          .filter(item => !savedExecutionIds.has(item.documentId))
          .map(item =>
            strapi.documents('api::test-cycle-execution.test-cycle-execution').delete({
              documentId: item.documentId,
            }),
          ),
      );

      const updatedCycle = await syncCycleStats(
        testCycleDocumentId,
        organizationDocumentId,
        projectDocumentId,
      );

      ctx.body = { data: updatedCycle };
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

      let existing = await strapi.documents('api::test-cycle-execution.test-cycle-execution').findOne({
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

      const testCycleDocumentId = existing.testCycle?.documentId ?? null;
      if (!testCycleDocumentId) {
        throw new errors.ValidationError('Test cycle execution testCycle is required.');
      }

      await dedupeCycleExecutions(testCycleDocumentId, existing.documentId);
      existing = await strapi.documents('api::test-cycle-execution.test-cycle-execution').findOne({
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

      if (!projectDocumentId) {
        throw new errors.ValidationError('Test cycle execution project is required.');
      }

      const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
        ...payload,
        project: payload.project ?? existing.project?.documentId,
        organization: payload.organization ?? existing.organization?.documentId,
      });
      const accessContext = await getCurrentExecutionAccessContext(
        userId,
        existing.organization?.documentId ?? organizationDocumentId,
        existing.assignedTesterName,
      );

      assertExecutionAssignmentAccess(existing, accessContext);
      assertExpectedVersion(existing, payload);

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
        assignedTesterName: hasOwnProperty(payload, 'assignedTesterName')
          ? payload.assignedTesterName
          : existing.assignedTesterName ?? null,
        assignedTesterEmail: hasOwnProperty(payload, 'assignedTesterEmail')
          ? payload.assignedTesterEmail
          : existing.assignedTesterEmail ?? null,
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

      const updatedCycle = await syncCycleStats(
        testCycleDocumentId,
        organizationDocumentId,
        projectDocumentId,
        documentId,
      );

      ctx.body = { data: updatedCycle };
    },
  }),
);
