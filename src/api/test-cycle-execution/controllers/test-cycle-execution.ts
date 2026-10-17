import tenantAccess from '../../../policies/tenant-access';
import { ENGINEERING_ROLES } from '../../../utils/access';
import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { ADMIN_ROLES } from '../../../utils/access';
import {
  extractConnectedDocumentId,
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

type ParticipantDirectoryMember = {
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

const lightTestCyclePopulate = {
  organization: true,
  project: true,
  sprint: true,
};

const executionDedupPopulate = {
  functionality: true,
  testCase: true,
  bug: true,
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

async function resolveParticipantDirectoryMemberForUser(
  userId: number,
  userEmail?: string | null,
  userUsername?: string | null,
) {
  const normalizedEmail = normalizeEmail(userEmail);
  const normalizedUsername = normalizeComparableValue(userUsername);

  if (!normalizedEmail && !normalizedUsername) {
    return null;
  }

  try {
    const members = (await strapi
      .service('api::participant-directory.participant-directory')
      .members(userId)) as ParticipantDirectoryMember[];

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
    strapi.log.warn('Unable to resolve participant directory member for execution access checks.');
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
  if (rawFunctionality === null) return null;
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

// Resolve the complete batch before any deduplication or persistence. Never pass
// unvalidated relation-operation objects through to the document service.
async function normalizeBatchExecutionRelations(
  payload: TestCycleExecutionPayload,
  organizationDocumentId: string,
  projectDocumentId: string,
  testCycleDocumentId: string,
  existing?: any,
) {
  const normalized = { ...payload };
  for (const key of ['functionality', 'testCase', 'bug'] as const) {
    if (existing && (!hasOwnProperty(payload, key) || payload[key] === undefined)) {
      normalized[key] = existing[key]?.documentId ?? null;
    }
  }
  for (const [key, expected] of [
    ['organization', organizationDocumentId], ['project', projectDocumentId], ['testCycle', testCycleDocumentId],
  ] as const) {
    if (hasOwnProperty(payload, key) && extractConnectedDocumentId(payload[key]) !== expected) {
      throw new errors.ValidationError(`Invalid ${key}: must match the persisted test cycle.`);
    }
  }

  let testCase: any = null;
  for (const [key, uid] of [
    ['functionality', 'api::functionality.functionality'],
    ['testCase', 'api::test-case.test-case'],
    ['bug', 'api::bug.bug'],
  ] as const) {
    if (!hasOwnProperty(normalized, key) || normalized[key] === undefined) continue;
    if (normalized[key] === null) continue;
    const documentId = extractConnectedDocumentId(normalized[key]);
    if (!documentId) throw new errors.ValidationError(`Invalid ${key} relation.`);
    const scope = {
      project: { documentId: projectDocumentId },
      organization: { documentId: organizationDocumentId },
    };
    const filters = { documentId, ...scope };
    let relation = key === 'testCase'
      ? await strapi.documents('api::test-case.test-case').findFirst({ filters, populate: { functionality: true } })
      : await strapi.documents(uid).findFirst({ filters });
    // The client also supplies functionality codes; resolve aliases within the
    // same persisted scope, never silently replace an invalid ID with null.
    if (!relation && key === 'functionality') {
      relation = await strapi.documents(uid).findFirst({ filters: { code: documentId, ...scope } });
    }
    if (!relation?.documentId) throw new errors.ValidationError(`Invalid ${key}: not found in the test cycle project and organization.`);
    normalized[key] = relation.documentId;
    if (key === 'testCase') testCase = relation;
  }
  if (testCase && normalized.functionality && testCase.functionality?.documentId !== normalized.functionality) {
    throw new errors.ValidationError('Invalid testCase: functionality must match.');
  }
  // Inherited values were inspected, not submitted. Preserve their omission so
  // a later merge uses the fresh canonical row rather than a stale snapshot.
  for (const key of ['functionality', 'testCase', 'bug'] as const) {
    if (!hasOwnProperty(payload, key) || payload[key] === undefined) delete normalized[key];
  }
  return normalized;
}

async function validateExecutionRelationsForParent(
  ctx: any, payload: TestCycleExecutionPayload, testCycleDocumentId: string, existing?: any,
) {
  const parent = await strapi.documents('api::test-cycle.test-cycle').findOne({
    documentId: testCycleDocumentId, populate: { organization: true, project: true },
  });
  if (!parent?.organization?.documentId || !parent.project?.documentId) {
    throw new errors.ValidationError('Invalid test cycle parent.');
  }
  await tenantAccess({ ...ctx, params: { documentId: testCycleDocumentId },
    request: { ...ctx.request, body: { data: {} } } },
    { contentTypeUid: 'api::test-cycle.test-cycle', allowedRoles: ENGINEERING_ROLES }, { strapi });
  return normalizeBatchExecutionRelations(payload, parent.organization.documentId,
    parent.project.documentId, testCycleDocumentId, existing);
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
    populate: executionDedupPopulate,
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

async function preauthorizeCycleExecutions(
  userId: number,
  organizationDocumentId: string,
  testCycleDocumentId: string,
  options: { all?: boolean; targetDocumentId?: string; identity?: string; preferredDocumentId?: string } = {},
) {
  const executions = await getCycleExecutions(testCycleDocumentId);
  const identities = executions.map(item => buildExecutionIdentity({
    moduleName: item.moduleName,
    functionalityName: item.functionalityName,
    functionalityDocumentId: item.functionality?.documentId,
    functionalityCode: item.functionality?.code,
    testCaseDocumentId: item.testCase?.documentId,
    testCaseTitle: item.testCase?.title || item.testCaseTitle,
  }));
  const counts = new Map<string, number>();
  for (const identity of identities) counts.set(identity, (counts.get(identity) || 0) + 1);
  const accessContext = await getCurrentExecutionAccessContext(
    userId, organizationDocumentId, executions.find(execution => execution.assignedTesterName)?.assignedTesterName,
  );
  // Deduplication can update the winner AND delete every other group member.
  // Batch replacement can additionally delete all omitted executions.
  const parent = await strapi.documents('api::test-cycle.test-cycle').findOne({
    documentId: testCycleDocumentId, populate: { organization: true, project: true },
  });
  if (parent?.organization?.documentId !== organizationDocumentId || !parent?.project?.documentId) {
    throw new errors.ValidationError('Invalid test cycle parent scope.');
  }
  const affectedGroups = new Map<string, any[]>();
  for (const [index, execution] of executions.entries()) {
    if (!options.all && execution.documentId !== options.targetDocumentId &&
      identities[index] !== options.identity && (counts.get(identities[index]) || 0) <= 1) continue;
    assertExecutionAssignmentAccess(execution, accessContext);
    await normalizeBatchExecutionRelations({}, organizationDocumentId, parent.project.documentId, testCycleDocumentId, execution);
    const group = affectedGroups.get(identities[index]) || [];
    group.push(execution);
    affectedGroups.set(identities[index], group);
  }
  // Individually valid fragments can still form an incoherent case/functionality
  // pair when combined. Check the same pure merge that dedupe will persist.
  const projectedExecutions = new Map<string, any>();
  for (const group of affectedGroups.values()) {
    if (group.length > 1) await normalizeBatchExecutionRelations({}, organizationDocumentId,
      parent.project.documentId, testCycleDocumentId, mergeExecutionGroup(group));
    const canonical = group.find(item => item.documentId === options.preferredDocumentId) || selectBestExecution(group);
    const merged = mergeExecutionGroup(group);
    const projected = { ...merged, documentId: canonical.documentId,
      functionality: canonical.functionality || merged.functionality,
      testCase: canonical.testCase || merged.testCase,
      bug: canonical.bug || merged.bug };
    for (const item of group) projectedExecutions.set(item.documentId, projected);
  }
  return projectedExecutions;
}

async function dedupeCycleExecutions(
  testCycleDocumentId: string,
  preferredDocumentId?: string,
  canonicalDocumentIds?: Map<string, string>,
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
    const canonical =
      group.find(item => item.documentId === preferredDocumentId) || selectBestExecution(group);
    for (const item of group) canonicalDocumentIds?.set(item.documentId, canonical.documentId);
    if (group.length <= 1) continue;

    const merged = mergeExecutionGroup(group);

    await strapi.documents('api::test-cycle-execution.test-cycle-execution').update({
      documentId: canonical.documentId,
      data: buildExecutionDocumentData({
        ...merged,
        functionality: canonical.functionality || merged.functionality,
        testCase: canonical.testCase || merged.testCase,
        bug: canonical.bug || merged.bug,
      }) as any,
      populate: executionDedupPopulate,
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
  options?: {
    lightResponse?: boolean;
  },
) {
  const dedupedExecutions = await dedupeCycleExecutions(testCycleDocumentId, preferredDocumentId);
  const refreshedCycle = await strapi.documents('api::test-cycle.test-cycle').findOne({
    documentId: testCycleDocumentId,
    populate: options?.lightResponse ? lightTestCyclePopulate : testCyclePopulate,
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
    populate: options?.lightResponse ? lightTestCyclePopulate : testCyclePopulate,
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
    const directoryMember = await resolveParticipantDirectoryMemberForUser(
      userId,
      user?.email,
      user?.username,
    );
    addEmailIdentity(identityKeys, directoryMember?.email);
    addComparableIdentity(identityKeys, directoryMember?.username);
    addComparableIdentity(identityKeys, directoryMember?.fullName);
    addComparableIdentity(identityKeys, directoryMember?.displayName);
    addComparableIdentity(identityKeys, directoryMember?.realName);
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

      let payload = (ctx.request.body?.data || {}) as TestCycleExecutionPayload;
      const projectDocumentId = extractRelationDocumentId(payload.project);
      const testCycleDocumentId = extractRelationDocumentId(payload.testCycle);

      if (!projectDocumentId) {
        throw new errors.ValidationError('Test cycle execution project is required.');
      }

      if (!testCycleDocumentId) {
        throw new errors.ValidationError('Test cycle execution testCycle is required.');
      }

      const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);
      payload = await validateExecutionRelationsForParent(ctx, payload, testCycleDocumentId);
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
      let duplicate = await findDuplicateExecution(testCycleDocumentId, identity);

      if (duplicate) {
        const canonicalDocumentId = duplicate.documentId;
        const projected = await preauthorizeCycleExecutions(userId, organizationDocumentId, testCycleDocumentId,
          { identity, preferredDocumentId: canonicalDocumentId });
        await normalizeBatchExecutionRelations(payload, organizationDocumentId, projectDocumentId,
          testCycleDocumentId, projected.get(canonicalDocumentId));
        const deduped = await dedupeCycleExecutions(testCycleDocumentId, canonicalDocumentId);
        duplicate = deduped.find(item => item.documentId === canonicalDocumentId);
        if (!duplicate) throw new errors.NotFoundError('Test cycle execution not found.');
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
            ...buildTestCycleExecutionData(safePayload, projectDocumentId, extractRelationDocumentId(safePayload.functionality)),
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

      await tenantAccess({ ...ctx, params: { ...ctx.params, documentId: ctx.params.documentId || ctx.params.id } },

        { contentTypeUid: 'api::test-cycle-execution.test-cycle-execution', allowedRoles: ENGINEERING_ROLES }, { strapi });
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

      let payload = (ctx.request.body?.data || {}) as TestCycleExecutionPayload;
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
      payload = await validateExecutionRelationsForParent(ctx, payload, testCycleDocumentId, existing);

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
        const projected = await preauthorizeCycleExecutions(userId, organizationDocumentId, testCycleDocumentId, {
          targetDocumentId: duplicate.documentId,
          preferredDocumentId: existing.documentId,
        });
        await normalizeBatchExecutionRelations(payload, organizationDocumentId, projectDocumentId,
          testCycleDocumentId, projected.get(existing.documentId) || existing);
        await dedupeCycleExecutions(testCycleDocumentId, existing.documentId);
        existing = await strapi.documents('api::test-cycle-execution.test-cycle-execution').findOne({
          documentId,
          populate: { organization: true, project: true, testCycle: true, ...executionDedupPopulate },
        });
        if (!existing) throw new errors.NotFoundError('Test cycle execution not found.');
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
          ...buildTestCycleExecutionData(safePayload, projectDocumentId, extractRelationDocumentId(safePayload.functionality)),
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

      await tenantAccess({ ...ctx, params: { documentId: testCycleDocumentId },
        request: { ...ctx.request, body: { data: {} } } },
        { contentTypeUid: 'api::test-cycle.test-cycle', allowedRoles: ENGINEERING_ROLES }, { strapi });

      const projectDocumentId = testCycle.project?.documentId ?? null;
      for (const [key, expected] of [['project', projectDocumentId], ['organization', testCycle.organization?.documentId]] as const) {
        if (hasOwnProperty(payload, key) && (!extractConnectedDocumentId(payload[key]) || extractConnectedDocumentId(payload[key]) !== expected)) {
          throw new errors.ValidationError(`Invalid ${key}: must match the persisted test cycle.`);
        }
      }

      if (!projectDocumentId) {
        throw new errors.ValidationError('Test cycle execution project is required.');
      }

      const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
        project: projectDocumentId,
        organization: requestedOrganizationDocumentId ?? testCycle.organization?.documentId ?? null,
      });

      const persistedExecutions = await getCycleExecutions(testCycleDocumentId);
      const preparedItems: BatchExecutionSyncItem[] = [];
      for (const item of items) {
        let existing = item?.documentId
          ? persistedExecutions.find(execution => execution.documentId === item.documentId) : null;
        if (item?.documentId && !existing) {
          throw new errors.ValidationError('Invalid execution: not found in the persisted test cycle.');
        }
        let data = await normalizeBatchExecutionRelations(
          item?.data || {}, organizationDocumentId, projectDocumentId, testCycleDocumentId, existing,
        );
        if (!existing) {
          const identity = buildExecutionIdentity({
            ...data,
            functionalityDocumentId: extractRelationDocumentId(data.functionality),
            testCaseDocumentId: extractRelationDocumentId(data.testCase),
          });
          existing = persistedExecutions.find(execution => buildExecutionIdentity({
            ...execution,
            functionalityDocumentId: execution.functionality?.documentId,
            functionalityCode: execution.functionality?.code,
            testCaseDocumentId: execution.testCase?.documentId,
            testCaseTitle: execution.testCase?.title || execution.testCaseTitle,
          }) === identity);
          if (existing) data = await normalizeBatchExecutionRelations(
            data, organizationDocumentId, projectDocumentId, testCycleDocumentId, existing,
          );
        }
        preparedItems.push({ ...item, documentId: existing?.documentId ?? item?.documentId, data });
      }

      const projected = await preauthorizeCycleExecutions(userId, organizationDocumentId, testCycleDocumentId, { all: true });
      const requestedCanonicalIds = new Set<string>();
      const requestedLookupIdentities = new Map<string, boolean>();
      const requestedFinalIdentities = new Set<string>();
      for (const item of preparedItems) {
        const existing = item.documentId ? projected.get(item.documentId) : undefined;
        if (existing && requestedCanonicalIds.has(existing.documentId)) {
          throw new errors.ValidationError('Ambiguous batch: multiple items target the same canonical execution.');
        }
        if (existing) requestedCanonicalIds.add(existing.documentId);
        const data = item.data || {};
        await normalizeBatchExecutionRelations(data, organizationDocumentId, projectDocumentId,
          testCycleDocumentId, existing);
        // Runtime indexes each saved row by the incoming identity, even for an
        // explicit ID. A new item must not reuse another item's lookup alias.
        const lookupIdentity = buildExecutionIdentity({
          ...data,
          functionalityDocumentId: extractRelationDocumentId(data.functionality),
          testCaseDocumentId: extractRelationDocumentId(data.testCase),
        });
        if (requestedLookupIdentities.has(lookupIdentity) &&
            (!existing || requestedLookupIdentities.get(lookupIdentity))) {
          throw new errors.ValidationError('Ambiguous batch: repeated execution lookup identity.');
        }
        requestedLookupIdentities.set(lookupIdentity, !existing);
        const effective = existing ? mergeExecutionPayloadWithExisting(existing, data,
          organizationDocumentId, projectDocumentId, testCycleDocumentId) : data;
        const finalIdentity = buildExecutionIdentity({
          ...effective,
          functionalityDocumentId: extractRelationDocumentId(effective.functionality),
          testCaseDocumentId: extractRelationDocumentId(effective.testCase),
        });
        if (requestedFinalIdentities.has(finalIdentity)) {
          throw new errors.ValidationError('Ambiguous batch: multiple items converge on the same execution identity.');
        }
        requestedFinalIdentities.add(finalIdentity);
      }
      const canonicalDocumentIds = new Map<string, string>();
      const dedupedExecutions = await dedupeCycleExecutions(testCycleDocumentId, undefined, canonicalDocumentIds);
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

      for (const item of preparedItems) {
        const executionPayload = (item?.data || {}) as TestCycleExecutionPayload;
        const functionalityDocumentId = extractRelationDocumentId(executionPayload.functionality);
        const executionIdentity = buildExecutionIdentity({
          moduleName: executionPayload.moduleName,
          functionalityName: executionPayload.functionalityName,
          functionalityDocumentId,
          testCaseDocumentId: extractRelationDocumentId(executionPayload.testCase),
          testCaseTitle: executionPayload.testCaseTitle,
        });

        const existingExecution =
          (item?.documentId
            ? existingExecutionsByDocumentId.get(canonicalDocumentIds.get(item.documentId) || item.documentId)
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
              ...buildTestCycleExecutionData(safePayload, projectDocumentId, extractRelationDocumentId(safePayload.functionality)),
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
        undefined,
        { lightResponse: true },
      );

      ctx.body = { data: updatedCycle };
    },

    async persist(ctx) {
      await tenantAccess({ ...ctx, params: { ...ctx.params, documentId: ctx.params.documentId || ctx.params.id } },
        { contentTypeUid: 'api::test-cycle-execution.test-cycle-execution', allowedRoles: ENGINEERING_ROLES }, { strapi });
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

      let payload = (ctx.request.body?.data || {}) as TestCycleExecutionPayload;
      payload = await validateExecutionRelationsForParent(ctx, payload, testCycleDocumentId, existing);
      const projectedFunctionalityDocumentId = await resolveFunctionalityDocumentId(
        payload.functionality, existing.project?.documentId, existing.functionality?.documentId ?? null,
      );
      const projected = await preauthorizeCycleExecutions(
        userId, existing.organization?.documentId, testCycleDocumentId,
        {
          targetDocumentId: existing.documentId,
          preferredDocumentId: existing.documentId,
          identity: buildExecutionIdentity({
            moduleName: payload.moduleName ?? existing.moduleName,
            functionalityName: payload.functionalityName ?? existing.functionalityName,
            functionalityDocumentId: projectedFunctionalityDocumentId,
            testCaseDocumentId: extractRelationDocumentId(payload.testCase) ?? existing.testCase?.documentId,
            testCaseTitle: payload.testCaseTitle ?? existing.testCaseTitle,
          }),
        },
      );
      await normalizeBatchExecutionRelations(payload, existing.organization?.documentId, existing.project?.documentId,
        testCycleDocumentId, projected.get(existing.documentId));
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
