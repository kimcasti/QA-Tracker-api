import { errors } from '@strapi/utils';
import {
  canExport,
  canUseAI,
  getAIUsageStatus,
  getExportUsageStatus,
  getEffectivePlan,
  incrementExportUsage,
  incrementAIUsage,
  type PlanReportKey,
} from '../../../utils/subscription';
import { assertOrganizationReportAvailable } from '../../../utils/plan-enforcement';
import { recomputeOrganizationUsageSnapshot } from '../../../utils/organization-usage';
import { getUserMemberships } from '../../../utils/tenant';

async function findProjectByIdentifierForOrganizations(
  projectIdentifier: string,
  allowedOrganizationDocumentIds: string[],
) {
  const normalizedIdentifier = String(projectIdentifier || '').trim();

  if (!normalizedIdentifier || allowedOrganizationDocumentIds.length === 0) {
    return null;
  }

  const numericId = Number(normalizedIdentifier);
  const identifierFilters = [
    { documentId: normalizedIdentifier },
    { key: normalizedIdentifier },
  ];

  if (Number.isFinite(numericId)) {
    identifierFilters.push({ id: numericId } as any);
  }

  return strapi.documents('api::project.project').findFirst({
    filters: {
      organization: {
        documentId: {
          $in: allowedOrganizationDocumentIds,
        },
      },
      $or: identifierFilters,
    } as any,
    populate: {
      organization: true,
    },
  });
}

async function getProjectOrganizationForUser(userId: number, projectIdentifier: string) {
  const memberships = await getUserMemberships(strapi, userId);
  const allowedOrganizationDocumentIds = memberships
    .map(membership => membership.organization?.documentId)
    .filter((value): value is string => Boolean(value));

  if (allowedOrganizationDocumentIds.length === 0) {
    throw new errors.ForbiddenError('An active organization membership is required.');
  }

  const project = await findProjectByIdentifierForOrganizations(
    projectIdentifier,
    allowedOrganizationDocumentIds,
  );

  if (!project?.documentId) {
    throw new errors.NotFoundError('Project not found.');
  }

  const organizationDocumentId = project.organization?.documentId;

  if (!organizationDocumentId || !allowedOrganizationDocumentIds.includes(organizationDocumentId)) {
    throw new errors.ForbiddenError('Cross-organization access is not allowed.');
  }

  return project.organization;
}

export default {
  async authorizeAi(userId: number, projectIdentifier: string) {
    const organization = await getProjectOrganizationForUser(userId, projectIdentifier);
    const effectivePlan = getEffectivePlan(organization);
    const aiUsageStatus = getAIUsageStatus(organization);

    if (!canUseAI(organization)) {
      if (!aiUsageStatus.featureEnabled) {
        throw new errors.ForbiddenError(
          'Tu plan Starter no incluye funciones de IA. Actualiza a Growth para continuar.',
        );
      }

      throw new errors.ForbiddenError(
        'Has alcanzado tu limite mensual de IA. Actualiza tu plan para continuar.',
      );
    }

    if (aiUsageStatus.didReset && organization?.documentId) {
      await strapi.documents('api::organization.organization').update({
        documentId: organization.documentId,
        data: {
          aiUsageThisMonth: aiUsageStatus.usedThisMonth,
          aiResetAt: aiUsageStatus.resetAt?.toISOString() || null,
        },
      });
    }

    return {
      allowed: true,
      plan: effectivePlan,
      feature: 'ai',
      aiUsage: {
        usedThisMonth: aiUsageStatus.usedThisMonth,
        limit: aiUsageStatus.limit,
        remaining: aiUsageStatus.remaining,
        resetAt: aiUsageStatus.resetAt?.toISOString() || null,
      },
    };
  },

  async authorizeExport(userId: number, projectIdentifier: string) {
    const organization = await getProjectOrganizationForUser(userId, projectIdentifier);
    const effectivePlan = getEffectivePlan(organization);
    const exportUsageStatus = getExportUsageStatus(organization);

    if (!canExport(organization)) {
      if (!exportUsageStatus.featureEnabled) {
        throw new errors.ForbiddenError(
          'Tu plan actual no incluye exportaciones. Actualiza a Growth para continuar.',
        );
      }

      throw new errors.ForbiddenError(
        'Has alcanzado tu limite mensual de exportaciones. Actualiza tu plan para continuar.',
      );
    }

    if (exportUsageStatus.didReset && organization?.documentId) {
      await strapi.documents('api::organization.organization').update({
        documentId: organization.documentId,
        data: {
          exportUsageThisMonth: exportUsageStatus.usedThisMonth,
          usageResetAt: exportUsageStatus.resetAt?.toISOString() || null,
        },
      });

      await recomputeOrganizationUsageSnapshot(organization.documentId);
    }

    return {
      allowed: true,
      plan: effectivePlan,
      feature: 'exports',
      exportUsage: {
        usedThisMonth: exportUsageStatus.usedThisMonth,
        limit: exportUsageStatus.limit,
        remaining: exportUsageStatus.remaining,
        resetAt: exportUsageStatus.resetAt?.toISOString() || null,
      },
    };
  },

  async authorizeReport(userId: number, projectIdentifier: string, report: PlanReportKey) {
    const organization = await getProjectOrganizationForUser(userId, projectIdentifier);
    const plan = getEffectivePlan(organization);

    const reportLabelMap: Record<PlanReportKey, string> = {
      qaStatusSummary: 'este reporte',
      qaProgress: 'este reporte',
      executiveProjectStatus: 'este reporte',
      deliveryUnitProgress: 'este reporte por unidad de entrega',
    };

    await assertOrganizationReportAvailable({
      organizationDocumentId: organization.documentId,
      report,
      reportLabel: reportLabelMap[report],
    });

    return {
      allowed: true,
      plan,
      report,
    };
  },

  async consumeAiUsage(userId: number, projectIdentifier: string, amount = 1) {
    const organization = await getProjectOrganizationForUser(userId, projectIdentifier);
    const nextUsage = incrementAIUsage(organization, amount);

    if (!organization?.documentId) {
      throw new errors.NotFoundError('Organization not found.');
    }

    await strapi.documents('api::organization.organization').update({
      documentId: organization.documentId,
      data: {
        aiUsageThisMonth: nextUsage.aiUsageThisMonth,
        aiResetAt: nextUsage.aiResetAt?.toISOString() || null,
      },
    });

    await recomputeOrganizationUsageSnapshot(organization.documentId);

    return {
      usedThisMonth: nextUsage.aiUsageThisMonth,
      resetAt: nextUsage.aiResetAt?.toISOString() || null,
    };
  },

  async consumeExportUsage(userId: number, projectIdentifier: string, amount = 1) {
    const organization = await getProjectOrganizationForUser(userId, projectIdentifier);
    const nextUsage = incrementExportUsage(organization, amount);

    if (!organization?.documentId) {
      throw new errors.NotFoundError('Organization not found.');
    }

    await strapi.documents('api::organization.organization').update({
      documentId: organization.documentId,
      data: {
        exportUsageThisMonth: nextUsage.exportUsageThisMonth,
        usageResetAt: nextUsage.usageResetAt?.toISOString() || null,
      },
    });

    await recomputeOrganizationUsageSnapshot(organization.documentId);

    return {
      usedThisMonth: nextUsage.exportUsageThisMonth,
      resetAt: nextUsage.usageResetAt?.toISOString() || null,
    };
  },
};
