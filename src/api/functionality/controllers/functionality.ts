import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { assertOrganizationLimitAvailable } from '../../../utils/plan-enforcement';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type FunctionalityPayload = {
  code?: string;
  name?: string;
  jiraIssueKey?: string | null;
  jiraTaskUrl?: string | null;
  jiraIssueType?: string | null;
  testTypes?: unknown;
  isCore?: boolean;
  isRegression?: boolean;
  isSmoke?: boolean;
  lastFunctionalChangeAt?: string | null;
  deliveryDate?: string | null;
  status?: 'completed' | 'failed' | 'in_progress' | 'backlog' | 'mvp' | 'post_mvp';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  impactLevel?: 'high' | 'medium' | 'low';
  probabilityLevel?: 'high' | 'medium' | 'low';
  storyLegacyId?: string | null;
  sortOrder?: number | null;
  organization?: unknown;
  project?: unknown;
  module?: unknown;
  sprint?: unknown;
  deliveryUnit?: unknown;
  personaRoles?: unknown;
};

type FunctionalityControllerDependencies = {
  assertOrganizationLimitAvailable: typeof assertOrganizationLimitAvailable;
  getUserMemberships: typeof getUserMemberships;
  getAllowedOrganizationDocumentIds: typeof getAllowedOrganizationDocumentIds;
  getOrganizationDocumentIdFromPayload: typeof getOrganizationDocumentIdFromPayload;
};

type CreateFunctionalityControllerInput = {
  strapi: typeof globalThis.strapi;
  dependencies?: Partial<FunctionalityControllerDependencies>;
};

type ReorderRequestItem = {
  documentId?: string;
  sortOrder?: number | null;
};

type FunctionalityDocumentWithRelations = {
  documentId: string;
  sortOrder?: number | null;
  project?: {
    documentId?: string;
  } | null;
  organization?: {
    documentId?: string;
  } | null;
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
    set?: Array<{ documentId?: string }>;
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

  if (Array.isArray(value.set)) {
    return {
      set: value.set.filter((item): item is { documentId: string } => Boolean(item?.documentId)),
    };
  }

  return null;
}

function buildFunctionalityData(payload: FunctionalityPayload) {
  const data: Record<string, unknown> = {
    code: payload.code || '',
    name: payload.name || '',
    jiraIssueKey: payload.jiraIssueKey?.trim() || null,
    jiraTaskUrl: payload.jiraTaskUrl?.trim() || null,
    jiraIssueType: payload.jiraIssueType?.trim() || null,
    testTypes: Array.isArray(payload.testTypes) ? payload.testTypes : [],
    isCore: Boolean(payload.isCore),
    isRegression: Boolean(payload.isRegression),
    isSmoke: Boolean(payload.isSmoke),
    lastFunctionalChangeAt: payload.lastFunctionalChangeAt || null,
    deliveryDate: payload.deliveryDate || null,
    status: payload.status || 'backlog',
    priority: payload.priority || 'medium',
    impactLevel: payload.impactLevel || 'medium',
    probabilityLevel: payload.probabilityLevel || 'medium',
    storyLegacyId: payload.storyLegacyId || null,
    sortOrder:
      typeof payload.sortOrder === 'number' && Number.isFinite(payload.sortOrder)
        ? payload.sortOrder
        : 0,
  };

  if (hasOwnProperty(payload, 'module')) {
    data.module = extractRelationDocumentId(payload.module);
  }

  if (hasOwnProperty(payload, 'sprint')) {
    data.sprint = extractRelationDocumentId(payload.sprint);
  }

  if (hasOwnProperty(payload, 'deliveryUnit')) {
    data.deliveryUnit = extractRelationDocumentId(payload.deliveryUnit);
  }

  if (hasOwnProperty(payload, 'personaRoles')) {
    data.personaRoles = normalizeManyRelation(payload.personaRoles) ?? { disconnect: [] };
  }

  return data;
}

async function findDuplicateFunctionality(
  strapiRef: typeof globalThis.strapi,
  projectDocumentId: string,
  code: string,
  excludeDocumentId?: string,
) {
  const matches = await strapiRef.documents('api::functionality.functionality').findMany({
    filters: {
      code: { $eq: code },
      project: { documentId: { $eq: projectDocumentId } },
    } as any,
    fields: ['documentId', 'code'],
  });

  return matches.find(item => item.documentId !== excludeDocumentId) || null;
}

async function resolveOrganizationDocumentId(
  input: CreateFunctionalityControllerInput,
  userId: number,
  payload: FunctionalityPayload,
) {
  const dependencies = {
    getUserMemberships,
    getAllowedOrganizationDocumentIds,
    getOrganizationDocumentIdFromPayload,
    ...input.dependencies,
  };
  const memberships = await dependencies.getUserMemberships(input.strapi, userId);
  const allowedOrganizationDocumentIds = dependencies.getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await dependencies.getOrganizationDocumentIdFromPayload(
    input.strapi,
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
  deliveryUnit: {
    fields: ['documentId', 'name', 'periodLabel', 'type'],
  },
};

export function createFunctionalityController(input: CreateFunctionalityControllerInput) {
  const dependencies = {
    assertOrganizationLimitAvailable,
    ...input.dependencies,
  };

  return {
  async reorder(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const rawItems = ctx.request.body?.data?.items;
    const items = Array.isArray(rawItems) ? (rawItems as ReorderRequestItem[]) : [];

    if (items.length === 0) {
      throw new errors.ValidationError('At least one functionality reorder item is required.');
    }

    const normalizedItems = items
      .map(item => ({
        documentId: typeof item?.documentId === 'string' ? item.documentId : '',
        sortOrder:
          typeof item?.sortOrder === 'number' && Number.isFinite(item.sortOrder)
            ? item.sortOrder
            : null,
      }))
      .filter(
        (item): item is { documentId: string; sortOrder: number } =>
          Boolean(item.documentId) && item.sortOrder !== null,
      );

    if (normalizedItems.length !== items.length) {
      throw new errors.ValidationError('Each reorder item must include documentId and sortOrder.');
    }

    const existingRecords = (await Promise.all(
      normalizedItems.map(item =>
        input.strapi.documents('api::functionality.functionality').findOne({
          documentId: item.documentId,
          populate: {
            organization: true,
            project: true,
          },
        }),
      ),
    )) as Array<FunctionalityDocumentWithRelations | null>;

    if (existingRecords.some(item => !item)) {
      throw new errors.NotFoundError('One or more functionalities were not found.');
    }

    const firstRecord = existingRecords[0];
    const sharedProjectDocumentId = firstRecord?.project?.documentId ?? null;
    const sharedOrganizationDocumentId = firstRecord?.organization?.documentId ?? null;

    if (!sharedProjectDocumentId || !sharedOrganizationDocumentId) {
      throw new errors.ValidationError('Functionality project and organization are required.');
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(input, userId, {
      project: sharedProjectDocumentId,
      organization: sharedOrganizationDocumentId,
    });

    if (organizationDocumentId !== sharedOrganizationDocumentId) {
      throw new errors.ForbiddenError('Cross-organization access is not allowed.');
    }

    const mismatchedRecord = existingRecords.find(
      item =>
        item?.project?.documentId !== sharedProjectDocumentId ||
        item?.organization?.documentId !== sharedOrganizationDocumentId,
    );

    if (mismatchedRecord) {
      throw new errors.ValidationError(
        'All reordered functionalities must belong to the same project and organization.',
      );
    }

    const updatedRecords = await Promise.all(
      normalizedItems.map(item =>
        input.strapi.documents('api::functionality.functionality').update({
          documentId: item.documentId,
          data: {
            sortOrder: item.sortOrder,
            organization: sharedOrganizationDocumentId,
            project: sharedProjectDocumentId,
          } as any,
          populate: responsePopulate as any,
        }),
      ),
    );

    ctx.body = { data: updatedRecords };
  },

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
      input.strapi,
      projectDocumentId,
      functionalityCode,
    );
    if (duplicateFunctionality) {
      throw new errors.ValidationError(
        `A functionality with code "${functionalityCode}" already exists in this project.`,
      );
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(input, userId, payload);
    await dependencies.assertOrganizationLimitAvailable({
      organizationDocumentId,
      limitKey: 'features',
      resourceLabel: 'funcionalidades',
    });

    const created = await input.strapi.documents('api::functionality.functionality').create({
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

    const existing = await input.strapi.documents('api::functionality.functionality').findOne({
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
      input.strapi,
      projectDocumentId,
      functionalityCode,
      existing.documentId,
    );
    if (duplicateFunctionality) {
      throw new errors.ValidationError(
        `A functionality with code "${functionalityCode}" already exists in this project.`,
      );
    }

    const organizationDocumentId = await resolveOrganizationDocumentId(input, userId, {
      ...payload,
      project: payload.project ?? existing.project?.documentId,
      organization: payload.organization ?? existing.organization?.documentId,
    });

    const updated = await input.strapi.documents('api::functionality.functionality').update({
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
  };
}

export default factories.createCoreController('api::functionality.functionality', () =>
  createFunctionalityController({ strapi }),
);
