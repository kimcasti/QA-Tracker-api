import { errors } from '@strapi/utils';
import type { PlanReportKey } from '../../../utils/subscription';

const REPORT_KEYS: PlanReportKey[] = ['qaStatusSummary', 'qaProgress', 'executiveProjectStatus'];

function getPayloadValue(ctx: any, key: string) {
  return String(ctx.request.body?.data?.[key] || ctx.request.body?.[key] || '').trim();
}

export default {
  async authorizeAi(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const projectDocumentId = getPayloadValue(ctx, 'projectId');

    if (!projectDocumentId) {
      throw new errors.ValidationError('Project documentId is required.');
    }

    const data = await strapi.service('api::plan-access.plan-access').authorizeAi(
      userId,
      projectDocumentId,
    );

    ctx.body = { data };
  },

  async authorizeExport(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const projectDocumentId = getPayloadValue(ctx, 'projectId');

    if (!projectDocumentId) {
      throw new errors.ValidationError('Project documentId is required.');
    }

    const data = await strapi.service('api::plan-access.plan-access').authorizeExport(
      userId,
      projectDocumentId,
    );

    ctx.body = { data };
  },

  async consumeExport(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const projectDocumentId = getPayloadValue(ctx, 'projectId');
    const amount = Number(ctx.request.body?.data?.amount || ctx.request.body?.amount || 1);

    if (!projectDocumentId) {
      throw new errors.ValidationError('Project documentId is required.');
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new errors.ValidationError('Amount must be a positive number.');
    }

    const data = await strapi.service('api::plan-access.plan-access').consumeExportUsage(
      userId,
      projectDocumentId,
      amount,
    );

    ctx.body = { data };
  },

  async authorizeReport(ctx) {
    const userId = ctx.state.user?.id;

    if (!userId) {
      throw new errors.UnauthorizedError('Authentication is required.');
    }

    const projectDocumentId = getPayloadValue(ctx, 'projectId');
    const report = getPayloadValue(ctx, 'report') as PlanReportKey;

    if (!projectDocumentId) {
      throw new errors.ValidationError('Project documentId is required.');
    }

    if (!REPORT_KEYS.includes(report)) {
      throw new errors.ValidationError('Report key is not valid.');
    }

    const data = await strapi.service('api::plan-access.plan-access').authorizeReport(
      userId,
      projectDocumentId,
      report,
    );

    ctx.body = { data };
  },
};
