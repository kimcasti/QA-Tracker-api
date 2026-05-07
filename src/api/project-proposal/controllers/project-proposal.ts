import { factories } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import {
  getAllowedOrganizationDocumentIds,
  getOrganizationDocumentIdFromPayload,
  getUserMemberships,
} from '../../../utils/tenant';

type ProposalPayload = {
  name?: string;
  status?: 'draft' | 'sent' | 'approved' | 'rejected' | 'archived';
  isPrimary?: boolean | null;
  serviceBillingPhases?: unknown;
  proposalType?: 'phases' | 'services' | 'mixed' | null;
  proposalSentAt?: string | null;
  projectStartAt?: string | null;
  contractNumber?: string | null;
  proposalNumber?: string | null;
  currency?: string | null;
  paymentTermsDays?: number | null;
  proposalOwner?: string | null;
  organization?: unknown;
  project?: unknown;
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

function normalizeProposalData(payload: ProposalPayload) {
  const normalizedServiceBillingPhases = Array.isArray(payload.serviceBillingPhases)
    ? JSON.stringify(payload.serviceBillingPhases)
    : payload.serviceBillingPhases == null
      ? null
      : String(payload.serviceBillingPhases || '').trim() || null;

  return {
    name: String(payload.name || '').trim(),
    status: payload.status || 'draft',
    isPrimary: payload.isPrimary === true,
    serviceBillingPhases: normalizedServiceBillingPhases,
    proposalType: payload.proposalType || null,
    proposalSentAt: payload.proposalSentAt || null,
    projectStartAt: payload.projectStartAt || null,
    contractNumber: String(payload.contractNumber || '').trim() || null,
    proposalNumber: String(payload.proposalNumber || '').trim() || null,
    currency: String(payload.currency || '').trim() || null,
    paymentTermsDays:
      typeof payload.paymentTermsDays === 'number' && Number.isFinite(payload.paymentTermsDays)
        ? payload.paymentTermsDays
        : null,
    proposalOwner: String(payload.proposalOwner || '').trim() || null,
  };
}

async function resolveOrganizationDocumentId(userId: number, payload: ProposalPayload) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = getAllowedOrganizationDocumentIds(memberships);

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const requestedOrganizationDocumentId = await getOrganizationDocumentIdFromPayload(
    strapi,
    'api::project-proposal.project-proposal',
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

async function ensureProjectDocumentId(projectDocumentId: string) {
  const project = await strapi.documents('api::project.project').findOne({
    documentId: projectDocumentId,
    populate: {
      organization: true,
    },
  });

  if (!project?.documentId) {
    throw new errors.NotFoundError('Project not found.');
  }

  return project;
}

function ensureOrganizationMatchesProject(
  organizationDocumentId: string,
  project: {
    organization?: {
      documentId?: string;
    };
  },
) {
  const projectOrganizationDocumentId = project.organization?.documentId || null;

  if (!projectOrganizationDocumentId) {
    throw new errors.ValidationError('Project organization is required.');
  }

  if (projectOrganizationDocumentId !== organizationDocumentId) {
    throw new errors.ForbiddenError(
      'Proposal organization must match the selected project organization.',
    );
  }
}

async function ensureSinglePrimaryProposal(
  projectDocumentId: string,
  currentProposalDocumentId?: string | null,
) {
  const siblings = await strapi
    .documents('api::project-proposal.project-proposal' as any)
    .findMany({
      filters: {
        project: {
          documentId: {
            $eq: projectDocumentId,
          },
        },
      },
      fields: ['documentId', 'isPrimary'],
    });

  await Promise.all(
    siblings
      .filter(
        proposal =>
          proposal.documentId &&
          proposal.documentId !== currentProposalDocumentId &&
          proposal.isPrimary === true,
      )
      .map(proposal =>
        strapi.documents('api::project-proposal.project-proposal' as any).update({
          documentId: proposal.documentId,
          data: {
            isPrimary: false,
          },
        }),
      ),
  );
}

async function shouldMarkAsPrimary(projectDocumentId: string, requestedPrimary: boolean) {
  if (requestedPrimary) {
    return true;
  }

  const existingPrimary = await strapi
    .documents('api::project-proposal.project-proposal' as any)
    .findFirst({
      filters: {
        project: {
          documentId: {
            $eq: projectDocumentId,
          },
        },
        isPrimary: true,
      },
      fields: ['documentId'],
    });

  return !existingPrimary?.documentId;
}

async function promoteReplacementPrimaryProposal(projectDocumentId: string) {
  const replacement = await strapi
    .documents('api::project-proposal.project-proposal' as any)
    .findFirst({
      filters: {
        project: {
          documentId: {
            $eq: projectDocumentId,
          },
        },
      },
      sort: ['createdAt:asc'],
      fields: ['documentId', 'isPrimary'],
    });

  if (!replacement?.documentId || replacement.isPrimary === true) {
    return;
  }

  await strapi.documents('api::project-proposal.project-proposal' as any).update({
    documentId: replacement.documentId,
    data: {
      isPrimary: true,
    },
  });
}

const responsePopulate = {
  project: {
    fields: ['documentId', 'key', 'name'],
  },
  organization: {
    fields: ['documentId', 'name'],
  },
};

export default factories.createCoreController(
  'api::project-proposal.project-proposal' as any,
  () => ({
    async create(ctx) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const payload = (ctx.request.body?.data || {}) as ProposalPayload;
      const projectDocumentId = extractRelationDocumentId(payload.project);

      if (!projectDocumentId) {
        throw new errors.ValidationError('Proposal project is required.');
      }

      const project = await ensureProjectDocumentId(projectDocumentId);
      const organizationDocumentId = await resolveOrganizationDocumentId(userId, payload);
      ensureOrganizationMatchesProject(organizationDocumentId, project);
      const shouldBePrimary = await shouldMarkAsPrimary(projectDocumentId, payload.isPrimary === true);

      const created = await strapi
        .documents('api::project-proposal.project-proposal' as any)
        .create({
          data: {
            ...normalizeProposalData(payload),
            isPrimary: shouldBePrimary,
            organization: organizationDocumentId,
            project: project.documentId,
          },
          populate: responsePopulate as any,
        });

      if (shouldBePrimary) {
        await ensureSinglePrimaryProposal(project.documentId, created.documentId);
      }

      ctx.body = { data: created };
    },

    async update(ctx) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const documentId = ctx.params.documentId || ctx.params.id;
      if (!documentId) {
        throw new errors.ValidationError('Proposal documentId is required.');
      }

      const existing = await strapi
        .documents('api::project-proposal.project-proposal' as any)
        .findOne({
          documentId,
          populate: {
            organization: true,
            project: true,
          } as any,
        });

      if (!existing) {
        throw new errors.NotFoundError('Proposal not found.');
      }

      const payload = (ctx.request.body?.data || {}) as ProposalPayload;
      const projectDocumentId =
        extractRelationDocumentId(payload.project) ?? existing.project?.documentId ?? null;

      if (!projectDocumentId) {
        throw new errors.ValidationError('Proposal project is required.');
      }

      const project = await ensureProjectDocumentId(projectDocumentId);
      const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
        ...payload,
        project: payload.project ?? existing.project?.documentId,
        organization: payload.organization ?? existing.organization?.documentId,
      });
      ensureOrganizationMatchesProject(organizationDocumentId, project);
      const shouldBePrimary =
        payload.isPrimary === false && existing.isPrimary === true
          ? true
          : await shouldMarkAsPrimary(projectDocumentId, payload.isPrimary === true);

      const updated = await strapi
        .documents('api::project-proposal.project-proposal' as any)
        .update({
          documentId,
          data: {
            ...normalizeProposalData(payload),
            isPrimary: shouldBePrimary,
            organization: organizationDocumentId,
            project: project.documentId,
          },
          populate: responsePopulate as any,
        });

      if (shouldBePrimary) {
        await ensureSinglePrimaryProposal(project.documentId, updated.documentId);
      }

      ctx.body = { data: updated };
    },

    async delete(ctx) {
      const userId = ctx.state.user?.id;

      if (!userId) {
        throw new errors.UnauthorizedError('Authentication is required.');
      }

      const documentId = ctx.params.documentId || ctx.params.id;
      if (!documentId) {
        throw new errors.ValidationError('Proposal documentId is required.');
      }

      const existing = await strapi
        .documents('api::project-proposal.project-proposal' as any)
        .findOne({
          documentId,
          populate: {
            organization: true,
            project: {
              populate: {
                organization: true,
              },
            },
          } as any,
        });

      if (!existing) {
        throw new errors.NotFoundError('Proposal not found.');
      }

      const organizationDocumentId = await resolveOrganizationDocumentId(userId, {
        organization: existing.organization?.documentId,
        project: existing.project?.documentId,
      });
      ensureOrganizationMatchesProject(organizationDocumentId, existing.project || {});

      const deleted = await strapi
        .documents('api::project-proposal.project-proposal' as any)
        .delete({
          documentId,
        });

      if (existing.isPrimary === true && existing.project?.documentId) {
        await promoteReplacementPrimaryProposal(existing.project.documentId);
      }

      ctx.body = { data: deleted };
    },
  }),
);
