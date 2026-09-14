import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type TestRunResultPayload = {
  orderIndex?: number | null;
  result?:
    | 'passed'
    | 'failed'
    | 'blocked'
    | 'not_executed'
    | 'in_progress'
    | 'skipped';
  notes?: string | null;
  evidenceImage?: string | null;
  bugTitle?: string | null;
  bugLink?: string | null;
  severity?: 'critical' | 'high' | 'medium' | 'low' | null;
  linkedBugId?: string | null;
  organization?: unknown;
  project?: unknown;
  testRun?: unknown;
  functionality?: unknown;
  testCase?: unknown;
  bug?: unknown;
};

type BatchTestRunResultSyncItem = {
  documentId?: string | null;
  data?: TestRunResultPayload | null;
};

type NormalizedBatchTestRunResultSyncItem = {
  documentId?: string | null;
  resultPayload: TestRunResultPayload;
  functionalityDocumentId: string | null;
  testCaseDocumentId: string | null;
  bugDocumentId: string | null;
  resultIdentity: string;
};

type BatchTestRunResultSyncPayload = {
  testRun?: unknown;
  project?: unknown;
  organization?: unknown;
  removeMissingResults?: boolean | null;
  items?: BatchTestRunResultSyncItem[] | null;
};
import { syncBatchTestRunResults } from '../services/test-run-result';

const testRunResultPopulate = {
  organization: true,
  project: true,
  testRun: true,
  functionality: true,
  testCase: true,
  bug: true,
};

const syncedTestRunPopulate = {
  project: true,
  sprint: true,
  publicUatSession: {
    populate: {
      externalParticipant: true,
    },
  },
  results: {
    sort: [{ orderIndex: 'asc' }, { createdAt: 'asc' }] as any,
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
async function resolveOrganizationDocumentId(userId: number, payload: TestRunResultPayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::test-run-result.test-run-result',
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

type ProjectCatalogRecord = {
  documentId?: string | null;
};

type FunctionalityCatalogRecord = ProjectCatalogRecord & {
  code?: string | null;
};

type TestCaseCatalogRecord = ProjectCatalogRecord & {
  title?: string | null;
};

type BugCatalogRecord = ProjectCatalogRecord & {
  internalBugId?: string | null;
  externalBugId?: string | null;
};

function normalizeCatalogKey(value?: string | null) {
  return String(value || '').trim();
}

function buildDocumentIdResolver<T extends ProjectCatalogRecord>(
  records: T[],
  keySelectors: Array<(record: T) => string | null | undefined>,
) {
  const recordsByDocumentId = new Map<string, string>();
  const recordsByAltKey = new Map<string, string>();

  records.forEach(record => {
    const documentId = normalizeCatalogKey(record.documentId);
    if (!documentId) {
      return;
    }

    recordsByDocumentId.set(documentId, documentId);

    keySelectors.forEach(selectKey => {
      const key = normalizeCatalogKey(selectKey(record));
      if (key) {
        recordsByAltKey.set(key, documentId);
      }
    });
  });

  return (rawValue: unknown, fallbackDocumentId?: string | null) => {
    const requestedDocumentId = normalizeCatalogKey(extractRelationDocumentId(rawValue));

    if (requestedDocumentId) {
      return (
        recordsByDocumentId.get(requestedDocumentId) ||
        recordsByAltKey.get(requestedDocumentId) ||
        fallbackDocumentId ||
        null
      );
    }

    return fallbackDocumentId ?? null;
  };
}

async function resolveTestCaseDocumentId(
  rawTestCase: unknown,
  projectDocumentId: string,
  fallbackDocumentId?: string | null,
) {
  const requestedDocumentId = extractRelationDocumentId(rawTestCase);

  if (requestedDocumentId) {
    const testCaseByDocumentId = await strapi
      .documents('api::test-case.test-case')
      .findFirst({
        filters: {
          documentId: requestedDocumentId,
          project: { documentId: projectDocumentId },
        },
      });

    if (testCaseByDocumentId?.documentId) {
      return testCaseByDocumentId.documentId;
    }

    const testCaseByTitle = await strapi
      .documents('api::test-case.test-case')
      .findFirst({
        filters: {
          title: requestedDocumentId,
          project: { documentId: projectDocumentId },
        },
      });

    if (testCaseByTitle?.documentId) {
      return testCaseByTitle.documentId;
    }
  }

  return fallbackDocumentId ?? null;
}

async function resolveBugDocumentId(
  rawBug: unknown,
  projectDocumentId: string,
  fallbackDocumentId?: string | null,
) {
  const requestedDocumentId = extractRelationDocumentId(rawBug);

  if (requestedDocumentId) {
    const bugByDocumentId = await strapi.documents('api::bug.bug').findFirst({
      filters: {
        documentId: requestedDocumentId,
        project: { documentId: projectDocumentId },
      },
    });

    if (bugByDocumentId?.documentId) {
      return bugByDocumentId.documentId;
    }

    const bugByInternalId = await strapi.documents('api::bug.bug').findFirst({
      filters: {
        internalBugId: requestedDocumentId,
        project: { documentId: projectDocumentId },
      },
    });

    if (bugByInternalId?.documentId) {
      return bugByInternalId.documentId;
    }

    const bugByExternalId = await strapi.documents('api::bug.bug').findFirst({
      filters: {
        externalBugId: requestedDocumentId,
        project: { documentId: projectDocumentId },
      },
    });

    if (bugByExternalId?.documentId) {
      return bugByExternalId.documentId;
    }
  }

  return fallbackDocumentId ?? null;
}

function buildTestRunResultData(
  payload: TestRunResultPayload,
  projectDocumentId: string,
  functionalityDocumentId?: string | null,
  testCaseDocumentId?: string | null,
  bugDocumentId?: string | null,
) {
  const data: Record<string, unknown> = {
    orderIndex:
      typeof payload.orderIndex === 'number' && Number.isFinite(payload.orderIndex)
        ? payload.orderIndex
        : null,
    result: payload.result || 'not_executed',
    notes: payload.notes || null,
    evidenceImage: payload.evidenceImage || null,
    bugTitle: payload.bugTitle || null,
    bugLink: payload.bugLink || null,
    severity: payload.severity || null,
    linkedBugId: payload.linkedBugId || null,
    project: projectDocumentId,
  };

  if (hasOwnProperty(payload, 'testRun')) {
    data.testRun = extractRelationDocumentId(payload.testRun);
  }

  if (hasOwnProperty(payload, 'functionality')) {
    data.functionality = functionalityDocumentId;
  }

  if (hasOwnProperty(payload, 'testCase')) {
    data.testCase = testCaseDocumentId ?? null;
  }

  if (hasOwnProperty(payload, 'bug')) {
    data.bug = bugDocumentId ?? null;
  }

  return data;
}

function buildResultIdentity(source: {
  functionalityDocumentId?: string | null;
  functionalityCode?: string | null;
  testCaseDocumentId?: string | null;
}) {
  const functionalityKey =
    extractRelationDocumentId(source.functionalityDocumentId) ||
    extractRelationDocumentId(source.functionalityCode) ||
    '__functionality__';
  const testCaseKey = extractRelationDocumentId(source.testCaseDocumentId) || '__test_case__';

  return `${functionalityKey}::${testCaseKey}`;
}

async function getRunResults(testRunDocumentId: string) {
  return (await strapi.documents('api::test-run-result.test-run-result').findMany({
    filters: {
      testRun: { documentId: testRunDocumentId },
    },
    sort: [{ orderIndex: 'asc' }, { createdAt: 'asc' }] as any,
    populate: testRunResultPopulate,
  })) as any[];
}

async function getSyncedTestRun(testRunDocumentId: string) {
  return strapi.documents('api::test-run.test-run').findOne({
    documentId: testRunDocumentId,
    populate: syncedTestRunPopulate as any,
  });
}

async function getProjectFunctionalityCatalog(projectDocumentId: string) {
  return (await strapi.documents('api::functionality.functionality').findMany({
    filters: {
      project: { documentId: projectDocumentId },
    },
    fields: ['documentId', 'code'],
  })) as FunctionalityCatalogRecord[];
}

async function getProjectTestCaseCatalog(projectDocumentId: string) {
  return (await strapi.documents('api::test-case.test-case').findMany({
    filters: {
      project: { documentId: projectDocumentId },
    },
    fields: ['documentId', 'title'],
  })) as TestCaseCatalogRecord[];
}

async function getProjectBugCatalog(projectDocumentId: string) {
  return (await strapi.documents('api::bug.bug').findMany({
    filters: {
      project: { documentId: projectDocumentId },
    },
    fields: ['documentId', 'internalBugId', 'externalBugId'],
  })) as BugCatalogRecord[];
}
export default factories.createCoreController('api::test-run-result.test-run-result', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as TestRunResultPayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);
    const testRunDocumentId = extractRelationDocumentId(payload.testRun);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test run result project is required.');
    }

    if (!testRunDocumentId) {
      throw new errors.ValidationError('Test run result testRun is required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);
    const functionalityDocumentId = await resolveFunctionalityDocumentId(
      payload.functionality,
      projectDocumentId,
    );
    const testCaseDocumentId = await resolveTestCaseDocumentId(
      payload.testCase,
      projectDocumentId,
    );
    const bugDocumentId = await resolveBugDocumentId(payload.bug, projectDocumentId);

    const created = await strapi.documents('api::test-run-result.test-run-result').create({
      data: {
        ...buildTestRunResultData(
          payload,
          projectDocumentId,
          functionalityDocumentId,
          testCaseDocumentId,
          bugDocumentId,
        ),
        organization: organizationDocumentId,
        testRun: testRunDocumentId,
      } as any,
      populate: testRunResultPopulate,
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
      throw new errors.ValidationError('Test run result documentId is required.');
    }

    const existing = await strapi.documents('api::test-run-result.test-run-result').findOne({
      documentId,
      populate: testRunResultPopulate,
    });

    if (!existing) {
      throw new errors.NotFoundError('Test run result not found.');
    }

    const payload = (ctx.request.body?.data || {}) as TestRunResultPayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;
    const testRunDocumentId =
      extractRelationDocumentId(payload.testRun) ?? existing.testRun?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test run result project is required.');
    }

    if (!testRunDocumentId) {
      throw new errors.ValidationError('Test run result testRun is required.');
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
    const testCaseDocumentId = await resolveTestCaseDocumentId(
      payload.testCase,
      projectDocumentId,
      existing.testCase?.documentId ?? null,
    );
    const bugDocumentId = await resolveBugDocumentId(
      payload.bug,
      projectDocumentId,
      existing.bug?.documentId ?? null,
    );

    const updated = await strapi.documents('api::test-run-result.test-run-result').update({
      documentId,
      data: {
        ...buildTestRunResultData(
          payload,
          projectDocumentId,
          functionalityDocumentId,
          testCaseDocumentId,
          bugDocumentId,
        ),
        organization: organizationDocumentId,
        testRun: testRunDocumentId,
      } as any,
      populate: testRunResultPopulate,
    });

    ctx.body = { data: updated };
  },

  async batchSync(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as BatchTestRunResultSyncPayload;
    const syncedTestRun = await syncBatchTestRunResults(userId, payload);
    ctx.body = { data: syncedTestRun };
  },
}));
