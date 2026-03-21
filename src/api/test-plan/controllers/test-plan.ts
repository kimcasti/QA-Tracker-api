import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type TestPlanPayload = {
  eventType?:
    | 'test'
    | 'client_meeting'
    | 'demo'
    | 'onboarding'
    | 'follow_up'
    | 'reminder';
  title?: string;
  scope?: 'total' | 'partial';
  impactModules?: unknown;
  date?: string;
  testType?:
    | 'integration'
    | 'functional'
    | 'sanity'
    | 'regression'
    | 'smoke'
    | 'exploratory'
    | 'uat';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  jiraId?: string | null;
  description?: string;
  time?: string | null;
  attendees?: string | null;
  owner?: string | null;
  organization?: unknown;
  project?: unknown;
  sprint?: unknown;
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

function normalizeTestPlanData(payload: TestPlanPayload) {
  const eventType = payload.eventType || 'test';
  const isTestEvent = eventType === 'test';

  return {
    eventType,
    title: payload.title || '',
    scope: isTestEvent ? payload.scope || 'total' : null,
    impactModules: isTestEvent && Array.isArray(payload.impactModules) ? payload.impactModules : [],
    date: payload.date || '',
    testType: isTestEvent ? payload.testType || 'regression' : null,
    priority: isTestEvent ? payload.priority || 'medium' : null,
    jiraId: isTestEvent ? payload.jiraId || null : null,
    description: payload.description || '',
    time: payload.time || null,
    attendees: payload.attendees || null,
    owner: payload.owner || null,
  };
}

async function resolveOrganizationDocumentId(userId: number, payload: TestPlanPayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::test-plan.test-plan',
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

export default factories.createCoreController('api::test-plan.test-plan', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as TestPlanPayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test plan project is required.');
    }

    const sprintDocumentId = extractRelationDocumentId(payload.sprint);
    const isTestEvent = (payload.eventType || 'test') === 'test';
    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

    const created = await strapi.documents('api::test-plan.test-plan').create({
      data: {
        ...normalizeTestPlanData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
        sprint: isTestEvent ? sprintDocumentId : null,
      },
      populate: {
        organization: true,
        project: true,
        sprint: true,
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
      throw new errors.ValidationError('Test plan documentId is required.');
    }

    const existing = await strapi.documents('api::test-plan.test-plan').findOne({
      documentId,
      populate: {
        organization: true,
        project: true,
        sprint: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Test plan not found.');
    }

    const payload = (ctx.request.body?.data || {}) as TestPlanPayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Test plan project is required.');
    }

    const nextEventType = payload.eventType ?? (existing as any).eventType ?? 'test';
    const isTestEvent = nextEventType === 'test';
    const sprintDocumentId = isTestEvent
      ? extractRelationDocumentId(payload.sprint) ?? existing.sprint?.documentId ?? null
      : null;

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await strapi.documents('api::test-plan.test-plan').update({
      documentId,
      data: {
        ...normalizeTestPlanData(payload),
        organization: organizationDocumentId,
        project: projectDocumentId,
        sprint: sprintDocumentId,
      },
      populate: {
        organization: true,
        project: true,
        sprint: true,
      },
    });

    ctx.body = { data: updated };
  },
}));
