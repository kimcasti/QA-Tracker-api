import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { ADMIN_ROLES } from '../../../utils/access';
import { getEffectivePlan } from '../../../utils/subscription';
import {
  assertOrganizationFeatureAvailable,
  assertOrganizationLimitAvailable,
} from '../../../utils/plan-enforcement';
import { getUserMemberships } from '../../../utils/tenant';

type ProjectPayload = {
  name?: string;
  key?: string;
  description?: string;
  version?: string;
  status?: 'active' | 'paused' | 'completed';
  icon?: string;
  logoDataUrl?: string | null;
  teamMembers?: unknown;
  purpose?: string;
  coreRequirements?: unknown;
  businessRules?: string;
  aiProjectInsights?: string;
  aiWireframeBrief?: string;
  serviceBillingPhases?: unknown;
  proposalType?: 'phases' | 'services' | 'mixed' | null;
  proposalSentAt?: string | null;
  projectStartAt?: string | null;
  contractNumber?: string | null;
  proposalNumber?: string | null;
  currency?: string | null;
  paymentTermsDays?: number | null;
  proposalOwner?: string | null;
  organization?: string;
};

function parseLogoDataUrl(value?: string | null) {
  const match = String(value || '').match(/^data:(.+?);base64,(.+)$/);

  if (!match) {
    return null;
  }

  try {
    return {
      mimeType: match[1],
      buffer: Buffer.from(match[2], 'base64'),
    };
  } catch {
    return null;
  }
}

function normalizeProjectData(payload: ProjectPayload) {
  const normalizedServiceBillingPhases = Array.isArray(payload.serviceBillingPhases)
    ? JSON.stringify(payload.serviceBillingPhases)
    : payload.serviceBillingPhases == null
      ? null
      : String(payload.serviceBillingPhases || '').trim() || null;

  return {
    name: payload.name || '',
    key: payload.key || '',
    description: payload.description || '',
    version: payload.version || '',
    status: payload.status || 'active',
    icon: payload.icon || '',
    logoDataUrl: payload.logoDataUrl ?? null,
    teamMembers: Array.isArray(payload.teamMembers) ? payload.teamMembers : [],
    purpose: payload.purpose || '',
    coreRequirements: Array.isArray(payload.coreRequirements) ? payload.coreRequirements : [],
    businessRules: payload.businessRules || '',
    aiProjectInsights: payload.aiProjectInsights || '',
    aiWireframeBrief: payload.aiWireframeBrief || '',
    serviceBillingPhases: normalizedServiceBillingPhases,
    proposalType: payload.proposalType || null,
    proposalSentAt: payload.proposalSentAt || null,
    projectStartAt: payload.projectStartAt || null,
    contractNumber: payload.contractNumber || null,
    proposalNumber: payload.proposalNumber || null,
    currency: payload.currency || null,
    paymentTermsDays:
      typeof payload.paymentTermsDays === 'number' && Number.isFinite(payload.paymentTermsDays)
        ? payload.paymentTermsDays
        : null,
    proposalOwner: payload.proposalOwner || null,
  };
}

function hasAiProjectPayload(payload: ProjectPayload) {
  return Boolean(payload.aiProjectInsights?.trim() || payload.aiWireframeBrief?.trim());
}

async function ensureProjectAccess(userId: number, projectDocumentId: string) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = memberships
    .map(membership => membership.organization?.documentId)
    .filter((value): value is string => Boolean(value));

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const project = await strapi.documents('api::project.project').findOne({
    documentId: projectDocumentId,
    populate: {
      organization: true,
    },
  });

  if (!project) {
    throw new errors.NotFoundError('Project not found.');
  }

  if (
    project.organization?.documentId &&
    !allowedOrganizationDocumentIds.includes(project.organization.documentId)
  ) {
    throw new errors.ForbiddenError('Cross-organization access is not allowed.');
  }

  return project;
}

async function resolveOrganizationDocumentId(userId: number, requestedOrganization?: string) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = memberships
    .map(membership => membership.organization?.documentId)
    .filter((value): value is string => Boolean(value));

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  if (requestedOrganization && allowedOrganizationDocumentIds.includes(requestedOrganization)) {
    return requestedOrganization;
  }

  return allowedOrganizationDocumentIds[0];
}

async function ensureProjectCreationAllowed(userId: number, requestedOrganization?: string) {
  const memberships = await getUserMemberships(strapi, userId);
  const targetMembership =
    (requestedOrganization
      ? memberships.find(
          membership => membership.organization?.documentId === requestedOrganization,
        )
      : null) || memberships[0];

  const organizationDocumentId = targetMembership?.organization?.documentId;
  const roleCode = targetMembership?.organizationRole?.code || '';

  if (!organizationDocumentId) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  if (!ADMIN_ROLES.includes(roleCode as any)) {
    throw new errors.ForbiddenError('Only Owner or QA Lead can create projects.');
  }

  const organization = await strapi.documents('api::organization.organization').findOne({
    documentId: organizationDocumentId,
  });

  if (!organization?.documentId) {
    throw new errors.NotFoundError('Organization not found.');
  }

  const plan = getEffectivePlan(organization);
  await assertOrganizationLimitAvailable({
    organizationDocumentId,
    limitKey: 'projects',
    resourceLabel: 'proyectos',
  });

  return {
    organizationDocumentId,
    plan,
  };
}

export default factories.createCoreController('api::project.project', () => ({
  async create(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const payload = (ctx.request.body?.data || {}) as ProjectPayload;
    const { organizationDocumentId, plan } = await ensureProjectCreationAllowed(
      userId,
      payload.organization,
    );

    if (hasAiProjectPayload(payload)) {
      await assertOrganizationFeatureAvailable({
        organizationDocumentId,
        feature: 'ai',
        featureLabel: 'funciones de IA para guardar insights o briefs generados',
      });
    }

    const created = await strapi.documents('api::project.project').create({
      data: {
        ...normalizeProjectData(payload),
        organization: organizationDocumentId,
      },
      populate: {
        organization: true,
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
      throw new errors.ValidationError('Project documentId is required.');
    }

    const existing = await strapi.documents('api::project.project').findOne({
      documentId,
      populate: {
        organization: true,
      },
    });

    if (!existing) {
      throw new errors.NotFoundError('Project not found.');
    }

    const payload = (ctx.request.body?.data || {}) as ProjectPayload;
    const organizationDocumentId = await resolveOrganizationDocumentId(
      userId,
      existing.organization?.documentId || payload.organization,
    );
    const organization = await strapi.documents('api::organization.organization').findOne({
      documentId: organizationDocumentId,
    });

    if (!organization?.documentId) {
      throw new errors.NotFoundError('Organization not found.');
    }

    const plan = getEffectivePlan(organization);

    if (hasAiProjectPayload(payload)) {
      await assertOrganizationFeatureAvailable({
        organizationDocumentId,
        feature: 'ai',
        featureLabel: 'funciones de IA para guardar insights o briefs generados',
      });
    }

    const updated = await strapi.documents('api::project.project').update({
      documentId,
      data: {
        ...normalizeProjectData(payload),
        organization: organizationDocumentId,
      },
      populate: {
        organization: true,
      },
    });

    ctx.body = { data: updated };
  },

  async storyMap(ctx) {
    const userId = ctx.state.user?.id;
    const projectDocumentId = ctx.params.documentId || ctx.params.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    if (!projectDocumentId) {
      throw new errors.ValidationError('Project documentId is required.');
    }

    await ensureProjectAccess(userId, projectDocumentId);

    const storyMap = await strapi.documents('api::project-story-map.project-story-map').findFirst({
      filters: {
        project: {
          documentId: {
            $eq: projectDocumentId,
          },
        },
      },
      populate: {
        organization: true,
        project: true,
      },
    });

    ctx.body = { data: storyMap ?? null };
  },

  async upsertStoryMap(ctx) {
    const userId = ctx.state.user?.id;
    const projectDocumentId = ctx.params.documentId || ctx.params.id;
    const snapshot = String(ctx.request.body?.data?.snapshot || '').trim();

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    if (!projectDocumentId) {
      throw new errors.ValidationError('Project documentId is required.');
    }

    if (!snapshot) {
      throw new errors.ValidationError('Story Map snapshot is required.');
    }

    const project = await ensureProjectAccess(userId, projectDocumentId);
    const organizationDocumentId = project.organization?.documentId;

    if (!organizationDocumentId) {
      throw new errors.ValidationError('Project organization is required.');
    }

    const existing = await strapi.documents('api::project-story-map.project-story-map').findFirst({
      filters: {
        project: {
          documentId: {
            $eq: projectDocumentId,
          },
        },
      },
    });

    const data = {
      snapshot,
      project: projectDocumentId,
      organization: organizationDocumentId,
    };

    const saved = existing?.documentId
      ? await strapi.documents('api::project-story-map.project-story-map').update({
          documentId: existing.documentId,
          data,
          populate: {
            organization: true,
            project: true,
          },
        })
      : await strapi.documents('api::project-story-map.project-story-map').create({
          data,
          populate: {
            organization: true,
            project: true,
          },
        });

    ctx.body = { data: saved };
  },

  async publicLogo(ctx) {
    const projectDocumentId = ctx.params.documentId || ctx.params.id;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Project documentId is required.');
    }

    const project = await strapi.documents('api::project.project').findOne({
      documentId: projectDocumentId,
    });

    if (!project?.logoDataUrl) {
      throw new errors.NotFoundError('Project logo not found.');
    }

    const parsedLogo = parseLogoDataUrl(project.logoDataUrl);

    if (!parsedLogo) {
      throw new errors.ValidationError('Project logo is not a valid image.');
    }

    ctx.set('Cache-Control', 'public, max-age=3600');
    ctx.type = parsedLogo.mimeType;
    ctx.body = parsedLogo.buffer;
  },
}));
