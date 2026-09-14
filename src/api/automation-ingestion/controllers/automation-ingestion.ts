import { errors } from '@strapi/utils';
import { ENGINEERING_ROLES } from '../../../utils/access';
import {
  getAllowedOrganizationDocumentIds,
  getAllowedAccessRoleCodes,
  getUserMemberships,
  getUserProjectAccessScope,
} from '../../../utils/tenant';
import { syncBatchTestRunResults } from '../../test-run-result/services/test-run-result';
import { assertConnectionProject } from '../../../utils/automation-connection';

type OpenRunPayload = {
  projectKey?: string | null;
  projectDocumentId?: string | null;
  tool?: 'playwright' | 'cypress' | 'postman' | 'k6' | 'webdriverio' | 'other' | null;
  title?: string | null;
  branch?: string | null;
  buildVersion?: string | null;
  environment?: 'test' | 'local' | 'production' | null;
  triggeredBy?: string | null;
  executionDate?: string | null;
  testType?:
    | 'integration'
    | 'functional'
    | 'sanity'
    | 'regression'
    | 'smoke'
    | 'exploratory'
    | 'uat'
    | null;
  priority?: 'critical' | 'high' | 'medium' | 'low' | null;
};

type PublishResultsPayload = {
  testRunDocumentId?: string | null;
  importedAt?: string | null;
  tool?: 'playwright' | 'cypress' | 'postman' | 'k6' | 'webdriverio' | 'other' | null;
  removeMissingResults?: boolean | null;
  results?: Array<{
    automationReference?: string | null;
    status?: 'passed' | 'failed' | 'skipped' | 'unknown' | null;
    notes?: string | null;
    evidenceImage?: string | null;
    bugTitle?: string | null;
    bugLink?: string | null;
    severity?: 'critical' | 'high' | 'medium' | 'low' | null;
    linkedBugId?: string | null;
  }> | null;
};

type AccessibleProject = {
  documentId: string;
  key: string;
  name?: string | null;
  organization?: {
    documentId?: string | null;
  } | null;
};

type ProjectAutomationTestCase = {
  documentId: string;
  title?: string | null;
  automationReference?: string | null;
  automationTool?: string | null;
  functionality?: {
    documentId?: string | null;
  } | null;
};

function normalizeReference(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function normalizeExecutionDate(value?: string | null) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return new Date().toISOString().slice(0, 10);
  }

  const parsedDate = new Date(rawValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return parsedDate.toISOString().slice(0, 10);
}

function buildAutomationRunDescription(payload: OpenRunPayload) {
  const metadata = [
    payload.tool ? `tool=${payload.tool}` : null,
    payload.branch ? `branch=${payload.branch}` : null,
    payload.triggeredBy ? `triggeredBy=${payload.triggeredBy}` : null,
  ].filter(Boolean);

  return metadata.length > 0 ? `Automation run (${metadata.join(', ')})` : 'Automation run';
}

export async function ensureEngineeringProjectAccess(userId: number, project: AccessibleProject) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);
  const allowedRoles = getAllowedAccessRoleCodes(memberships.filter(m => m.organization?.documentId === project.organization?.documentId));
  const projectAccessScope = await getUserProjectAccessScope(strapi, userId, memberships);
  const organizationDocumentId = project.organization?.documentId || null;

  if (!organizationDocumentId || !allowedOrganizationDocumentIds.includes(organizationDocumentId)) {
    throw new errors.ForbiddenError('Cross-organization access is not allowed.');
  }

  if (!allowedRoles.some(role => ENGINEERING_ROLES.includes(role as any))) {
    throw new errors.ForbiddenError('Only engineering roles can manage automation runs.');
  }

  if (
    projectAccessScope.restrictedOrganizationDocumentIds.includes(organizationDocumentId) &&
    !projectAccessScope.allowedProjectDocumentIds.includes(project.documentId)
  ) {
    throw new errors.ForbiddenError('Your role is not assigned to this project.');
  }

  return {
    organizationDocumentId,
  };
}

export async function findAccessibleProject(userId: number, payload: OpenRunPayload) {
  const projectKey = String(payload.projectKey || '').trim();
  const projectDocumentId = String(payload.projectDocumentId || '').trim();

  if (!projectKey && !projectDocumentId) {
    throw new errors.ValidationError('projectKey or projectDocumentId is required.');
  }

  const project = (await strapi.documents('api::project.project').findFirst({
    filters: projectDocumentId
      ? { documentId: projectDocumentId }
      : {
          key: projectKey,
        },
    fields: ['documentId', 'key', 'name'],
    populate: {
      organization: {
        fields: ['documentId'],
      },
    },
  })) as AccessibleProject | null;

  if (!project?.documentId) {
    throw new errors.NotFoundError('Project not found.');
  }

  await ensureEngineeringProjectAccess(userId, project);
  return project;
}

function mapAutomationStatusToRunResult(status?: string | null) {
  switch ((status || '').toLowerCase()) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'skipped':
    case 'unknown':
    default:
      return 'not_executed';
  }
}

async function getProjectAutomationTestCases(projectDocumentId: string) {
  return (await strapi.documents('api::test-case.test-case').findMany({
    filters: {
      project: {
        documentId: projectDocumentId,
      },
      automationStatus: 'automated',
    },
    fields: ['documentId', 'title', 'automationReference', 'automationTool'],
    populate: {
      functionality: {
        fields: ['documentId'],
      },
    },
  })) as ProjectAutomationTestCase[];
}

async function updateMatchedTestCaseAutomationState(
  testCaseDocumentId: string,
  input: {
    status?: 'passed' | 'failed' | 'skipped' | 'unknown' | null;
    tool?: string | null;
    importedAt: string;
  },
) {
  await strapi.documents('api::test-case.test-case').update({
    documentId: testCaseDocumentId,
    data: {
      lastAutomationStatus: input.status || 'unknown',
      lastAutomationRunAt: input.importedAt,
      ...(input.tool ? { automationTool: input.tool } : {}),
    } as any,
  });
}

export default {
  async openRun(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as OpenRunPayload;
    const project = await findAccessibleProject(userId, payload);
    assertConnectionProject(ctx, project.documentId);
    const { organizationDocumentId } = await ensureEngineeringProjectAccess(userId, project);

    const created = await strapi.documents('api::test-run.test-run').create({
      data: {
        title: String(payload.title || '').trim() || `Automation Run ${new Date().toISOString()}`,
        description: buildAutomationRunDescription(payload),
        executionDate: normalizeExecutionDate(payload.executionDate),
        status: 'draft',
        testType: payload.testType || 'smoke',
        priority: payload.priority || 'medium',
        tester: String(payload.triggeredBy || '').trim() || 'local-automation',
        buildVersion: String(payload.buildVersion || '').trim() || null,
        environment: payload.environment || 'local',
        identifiedRisks: [],
        exitCriteria: [],
        selectedModules: [],
        selectedFunctionalities: [],
        organization: organizationDocumentId,
        project: project.documentId,
      } as any,
      populate: {
        organization: true,
        project: true,
        sprint: true,
        results: true,
      },
    });

    ctx.body = {
      data: {
        testRunDocumentId: created.documentId,
        projectDocumentId: project.documentId,
        organizationDocumentId,
        projectKey: project.key,
        title: created.title,
        status: created.status,
      },
    };
  },

  async publishResults(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as PublishResultsPayload;
    const testRunDocumentId = String(payload.testRunDocumentId || '').trim();
    const importedAt = String(payload.importedAt || '').trim() || new Date().toISOString();
    const tool = String(payload.tool || 'playwright').trim().toLowerCase();
    const inputResults = Array.isArray(payload.results) ? payload.results : [];

    if (!testRunDocumentId) {
      throw new errors.ValidationError('testRunDocumentId is required.');
    }

    const testRun = await strapi.documents('api::test-run.test-run').findOne({
      documentId: testRunDocumentId,
      populate: {
        organization: true,
        project: {
          fields: ['documentId', 'key', 'name'],
          populate: {
            organization: {
              fields: ['documentId'],
            },
          },
        },
      },
    });

    if (!testRun?.documentId || !testRun.project?.documentId) {
      throw new errors.NotFoundError('Test run not found.');
    }

    const project = testRun.project as AccessibleProject;
    assertConnectionProject(ctx, project.documentId);
    const { organizationDocumentId } = await ensureEngineeringProjectAccess(userId, project);

    const testCases = await getProjectAutomationTestCases(project.documentId);
    const testCaseByReference = new Map<string, ProjectAutomationTestCase>();
    const missingReferenceCases: Array<{ testCaseId: string; testCaseTitle: string }> = [];

    testCases.forEach(testCase => {
      const normalizedReference = normalizeReference(testCase.automationReference);
      if (!normalizedReference) {
        missingReferenceCases.push({
          testCaseId: testCase.documentId,
          testCaseTitle: testCase.title || 'Caso sin titulo',
        });
        return;
      }

      if (!testCaseByReference.has(normalizedReference)) {
        testCaseByReference.set(normalizedReference, testCase);
      }
    });

    const seenReferences = new Set<string>();
    const duplicateReportReferences = new Set<string>();
    const unmatchedReportReferences = new Set<string>();
    const matchedCases: Array<{
      testCaseId: string;
      testCaseTitle: string;
      reference: string;
      status: 'passed' | 'failed' | 'skipped' | 'unknown';
    }> = [];
    const syncItems: Array<{ data: Record<string, unknown> }> = [];

    for (const result of inputResults) {
      const normalizedReference = normalizeReference(result.automationReference);
      if (!normalizedReference) {
        continue;
      }

      if (seenReferences.has(normalizedReference)) {
        duplicateReportReferences.add(result.automationReference || normalizedReference);
        continue;
      }

      seenReferences.add(normalizedReference);
      const matchedTestCase = testCaseByReference.get(normalizedReference);

      if (!matchedTestCase?.documentId || !matchedTestCase.functionality?.documentId) {
        unmatchedReportReferences.add(result.automationReference || normalizedReference);
        continue;
      }

      const normalizedStatus = (String(result.status || 'unknown').trim().toLowerCase() ||
        'unknown') as 'passed' | 'failed' | 'skipped' | 'unknown';

      matchedCases.push({
        testCaseId: matchedTestCase.documentId,
        testCaseTitle: matchedTestCase.title || 'Caso sin titulo',
        reference: result.automationReference || '',
        status: normalizedStatus,
      });

      syncItems.push({
        data: {
          result: mapAutomationStatusToRunResult(normalizedStatus),
          notes: result.notes || null,
          evidenceImage: result.evidenceImage || null,
          bugTitle: result.bugTitle || null,
          bugLink: result.bugLink || null,
          severity: result.severity || null,
          linkedBugId: result.linkedBugId || null,
          organization: organizationDocumentId,
          project: project.documentId,
          testRun: testRunDocumentId,
          functionality: matchedTestCase.functionality.documentId,
          testCase: matchedTestCase.documentId,
        },
      });

      await updateMatchedTestCaseAutomationState(matchedTestCase.documentId, {
        status: normalizedStatus,
        tool,
        importedAt,
      });
    }

    const syncedRun = await syncBatchTestRunResults(userId, {
      testRun: testRunDocumentId,
      project: project.documentId,
      organization: organizationDocumentId,
      removeMissingResults: payload.removeMissingResults !== false,
      items: syncItems,
    });

    const matchedCaseIds = new Set(matchedCases.map(item => item.testCaseId));
    const unmatchedExecutionCases = testCases
      .filter(testCase => {
        const normalizedReference = normalizeReference(testCase.automationReference);
        return normalizedReference && !matchedCaseIds.has(testCase.documentId);
      })
      .map(testCase => ({
        testCaseId: testCase.documentId,
        testCaseTitle: testCase.title || 'Caso sin titulo',
        reference: testCase.automationReference || '',
      }));

    await strapi.documents('api::automation-import-history.automation-import-history' as any).create({
      data: {
        tool,
        importedAt,
        matchedCount: matchedCases.length,
        missingReferenceCount: missingReferenceCases.length,
        unmatchedExecutionCount: unmatchedExecutionCases.length,
        unmatchedReportReferenceCount: unmatchedReportReferences.size,
        duplicateReferenceCount: duplicateReportReferences.size,
        matchedCases: matchedCases.map(item => ({
          testCaseId: item.testCaseId,
          testCaseTitle: item.testCaseTitle,
          reference: item.reference,
          status: item.status,
        })),
        organization: organizationDocumentId,
        project: project.documentId,
        testRun: testRunDocumentId,
      },
    });

    ctx.body = {
      data: {
        testRun: syncedRun,
        summary: {
          matchedCases,
          missingReferenceCases,
          unmatchedExecutionCases,
          unmatchedReportReferences: Array.from(unmatchedReportReferences),
          duplicateReportReferences: Array.from(duplicateReportReferences),
        },
      },
    };
  },
};
