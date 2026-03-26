import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type FunctionalityPayload = {
  code?: string;
  name?: string;
  testTypes?: unknown;
  isCore?: boolean;
  isRegression?: boolean;
  isSmoke?: boolean;
  lastFunctionalChangeAt?: string | null;
  deliveryDate?: string | null;
  status?: 'completed' | 'failed' | 'in_progress' | 'backlog' | 'mvp' | 'post_mvp';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  riskLevel?: 'high' | 'medium' | 'low';
  storyLegacyId?: string | null;
  organization?: unknown;
  project?: unknown;
  module?: unknown;
  sprint?: unknown;
  personaRoles?: unknown;
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

function normalizeManyRelation(rawValue: unknown) {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const value = rawValue as {
    connect?: Array<{ documentId?: string }>;
    disconnect?: Array<{ documentId?: string }>;
  };

  if (Array.isArray(value.connect)) {
    return {
      connect: value.connect.filter(
        (item): item is { documentId: string } => Boolean(item?.documentId),
      ),
    };
  }

  if (Array.isArray(value.disconnect)) {
    return {
      disconnect: value.disconnect.filter(
        (item): item is { documentId: string } => Boolean(item?.documentId),
      ),
    };
  }

  return null;
}

function buildFunctionalityData(payload: FunctionalityPayload) {
  const data: Record<string, unknown> = {
    code: payload.code || '',
    name: payload.name || '',
    testTypes: Array.isArray(payload.testTypes) ? payload.testTypes : [],
    isCore: Boolean(payload.isCore),
    isRegression: Boolean(payload.isRegression),
    isSmoke: Boolean(payload.isSmoke),
    lastFunctionalChangeAt: payload.lastFunctionalChangeAt || null,
    deliveryDate: payload.deliveryDate || null,
    status: payload.status || 'backlog',
    priority: payload.priority || 'medium',
    riskLevel: payload.riskLevel || 'medium',
    storyLegacyId: payload.storyLegacyId || null,
  };

  if (hasOwnProperty(payload, 'module')) {
    data.module = extractRelationDocumentId(payload.module);
  }

  if (hasOwnProperty(payload, 'sprint')) {
    data.sprint = extractRelationDocumentId(payload.sprint);
  }

  if (hasOwnProperty(payload, 'personaRoles')) {
    data.personaRoles = normalizeManyRelation(payload.personaRoles) ?? { disconnect: [] };
  }

  return data;
}

async function findDuplicateFunctionality(
  projectDocumentId: string,
  code: string,
  excludeDocumentId?: string,
) {
  const matches = await strapi.documents('api::functionality.functionality').findMany({
    filters: {
      code: { $eq: code },
      project: { documentId: { $eq: projectDocumentId } },
    } as any,
    fields: ['documentId', 'code'],
  });

  return matches.find(item => item.documentId !== excludeDocumentId) || null;
}

async function resolveOrganizationDocumentId(userId: number, payload: FunctionalityPayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::functionality.functionality',
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

const responsePopulate = {
  project: {
    fields: ['key'],
  },
  module: {
    fields: ['name'],
  },
  personaRoles: {
    fields: ['name'],
  },
  sprint: {
    fields: ['name'],
  },
};

export default factories.createCoreController('api::functionality.functionality', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as FunctionalityPayload;
    const projectDocumentId = extractRelationDocumentId(payload.project);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Functionality project is required.');
    }

    const functionalityCode = payload.code?.trim();
    if (!functionalityCode) {
      throw new errors.ValidationError('Functionality code is required.');
    }

    const duplicateFunctionality = await findDuplicateFunctionality(
      projectDocumentId,
      functionalityCode,
    );
    if (duplicateFunctionality) {
      throw new errors.ValidationError(
        `A functionality with code "${functionalityCode}" already exists in this project.`,
      );
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);

    const created = await strapi.documents('api::functionality.functionality').create({
      data: {
        ...buildFunctionalityData({ ...payload, code: functionalityCode }),
        organization: organizationDocumentId,
        project: projectDocumentId,
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
      throw new errors.ValidationError('Functionality documentId is required.');
    }

    const existing = await strapi.documents('api::functionality.functionality').findOne({
      documentId,
      populate: {
        organization: true,
        project: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Functionality not found.');
    }

    const payload = (ctx.request.body?.data || {}) as FunctionalityPayload;
    const projectDocumentId =
      extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Functionality project is required.');
    }

    const functionalityCode = payload.code?.trim() || existing.code?.trim();
    if (!functionalityCode) {
      throw new errors.ValidationError('Functionality code is required.');
    }

    const duplicateFunctionality = await findDuplicateFunctionality(
      projectDocumentId,
      functionalityCode,
      existing.documentId,
    );
    if (duplicateFunctionality) {
      throw new errors.ValidationError(
        `A functionality with code "${functionalityCode}" already exists in this project.`,
      );
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await strapi.documents('api::functionality.functionality').update({
      documentId,
      data: {
        ...buildFunctionalityData({ ...payload, code: functionalityCode }),
        organization: organizationDocumentId,
        project: projectDocumentId,
      } as any,
      populate: responsePopulate as any,
    });

    ctx.body = { data: updated };
  },
}));
