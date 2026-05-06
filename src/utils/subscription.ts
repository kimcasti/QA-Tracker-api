export const GROWTH_PLAN_PRICE_MONTHLY_USD = 5;
export const PRO_PLAN_PRICE_MONTHLY_USD = GROWTH_PLAN_PRICE_MONTHLY_USD;

export type OrganizationPlan = 'starter' | 'growth' | 'enterprise';
export type OrganizationPlanStatus = 'active' | 'past_due' | 'canceled';
export type PlanFeatureKey = 'ai' | 'templates' | 'audit' | 'exports';
export type PlanReportKey = 'qaStatusSummary' | 'qaProgress' | 'executiveProjectStatus';
export type PlanLimitKey = 'projects' | 'users' | 'features' | 'testCases';
export type PlanMonthlyAllowanceKey = 'aiRequests' | 'exports';

export type PlanAwareOrganizationLike = {
  plan?: string | null;
  planStatus?: OrganizationPlanStatus | null;
  planExpiresAt?: Date | string | null;
  gracePeriodEndsAt?: Date | string | null;
  planUpdatedAt?: Date | string | null;
  aiUsageThisMonth?: number | null;
  aiResetAt?: Date | string | null;
  aiLimit?: number | null;
  exportUsageThisMonth?: number | null;
  usageResetAt?: Date | string | null;
  exportLimitMonthly?: number | null;
  billingNotes?: string | null;
};

type PlanReportAccess = {
  qaStatusSummary: boolean;
  qaProgress: boolean;
  executiveProjectStatus: boolean;
};

type LimitedPlanConfig = {
  projects: number;
  users: number;
  features: number;
  testCases: number;
  ai: boolean;
  templates: boolean;
  audit: boolean;
  exports: boolean;
  reports: PlanReportAccess;
};

type UnlimitedPlanConfig = {
  unlimited: true;
  ai: boolean;
  templates: boolean;
  audit: boolean;
  exports: boolean;
  reports: PlanReportAccess;
};

export type PlanConfig = LimitedPlanConfig | UnlimitedPlanConfig;

type PlanMonthlyAllowanceConfig = {
  aiRequests: number | null;
  exports: number | null;
};

export const PLAN_LIMITS: Record<OrganizationPlan, PlanConfig> = {
  starter: {
    projects: 3,
    users: 5,
    features: 100,
    testCases: 200,
    ai: false,
    templates: true,
    audit: false,
    exports: true,
    reports: {
      qaStatusSummary: true,
      qaProgress: false,
      executiveProjectStatus: false,
    },
  },
  growth: {
    projects: 15,
    users: 25,
    features: 1000,
    testCases: 2000,
    ai: true,
    templates: true,
    audit: true,
    exports: true,
    reports: {
      qaStatusSummary: true,
      qaProgress: true,
      executiveProjectStatus: true,
    },
  },
  enterprise: {
    unlimited: true,
    ai: true,
    templates: true,
    audit: true,
    exports: true,
    reports: {
      qaStatusSummary: true,
      qaProgress: true,
      executiveProjectStatus: true,
    },
  },
};

export const PLAN_MONTHLY_ALLOWANCES: Record<OrganizationPlan, PlanMonthlyAllowanceConfig> = {
  starter: {
    aiRequests: 0,
    exports: 10,
  },
  growth: {
    aiRequests: 50,
    exports: 100,
  },
  enterprise: {
    aiRequests: null,
    exports: null,
  },
};

export function normalizeOrganizationPlan(plan?: string | null): OrganizationPlan {
  if (plan === 'growth' || plan === 'enterprise') {
    return plan;
  }

  return 'starter';
}

export function getPlanConfig(plan?: string | null): PlanConfig {
  return PLAN_LIMITS[normalizeOrganizationPlan(plan)];
}

export function getPlanMonthlyAllowanceConfig(plan?: string | null): PlanMonthlyAllowanceConfig {
  return PLAN_MONTHLY_ALLOWANCES[normalizeOrganizationPlan(plan)];
}

export function isUnlimitedPlan(plan?: string | null): boolean {
  return 'unlimited' in getPlanConfig(plan);
}

export function getPlanLimitValue(
  plan: string | null | undefined,
  limitKey: PlanLimitKey,
): number | null {
  const config = getPlanConfig(plan);

  if ('unlimited' in config) {
    return null;
  }

  return config[limitKey];
}

export function getProjectLimitForPlan(plan?: string | null) {
  return getPlanLimitValue(plan, 'projects');
}

export function getPlanMonthlyAllowanceValue(
  plan: string | null | undefined,
  allowanceKey: PlanMonthlyAllowanceKey,
): number | null {
  return getPlanMonthlyAllowanceConfig(plan)[allowanceKey];
}

export function canUsePlanFeature(
  plan: string | null | undefined,
  feature: PlanFeatureKey,
): boolean {
  return Boolean(getPlanConfig(plan)[feature]);
}

export function canUsePlanReport(
  plan: string | null | undefined,
  report: PlanReportKey,
): boolean {
  return Boolean(getPlanConfig(plan).reports[report]);
}

function toValidDate(value?: Date | string | null): Date | null {
  if (!value) {
    return null;
  }

  const normalized = value instanceof Date ? value : new Date(value);
  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

function startOfNextMonth(baseDate: Date): Date {
  return new Date(
    Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth() + 1,
      1,
      0,
      0,
      0,
      0,
    ),
  );
}

function normalizeCounterValue(value?: number | null) {
  return Math.max(0, Number(value || 0));
}

function resetMonthlyUsageIfNeeded(input: {
  currentUsed?: number | null;
  resetAt?: Date | string | null;
  now?: Date;
}) {
  const currentUsed = normalizeCounterValue(input.currentUsed);
  const now = input.now || new Date();
  const resetAt = toValidDate(input.resetAt);

  if (!resetAt || resetAt.getTime() <= now.getTime()) {
    return {
      usedThisMonth: 0,
      resetAt: startOfNextMonth(now),
      didReset: true,
    };
  }

  return {
    usedThisMonth: currentUsed,
    resetAt,
    didReset: false,
  };
}

export function isPlanActive(organization?: PlanAwareOrganizationLike | null): boolean {
  return (organization?.planStatus || 'active') === 'active';
}

export function isInGracePeriod(
  organization?: PlanAwareOrganizationLike | null,
  now: Date = new Date(),
): boolean {
  if ((organization?.planStatus || 'active') !== 'past_due') {
    return false;
  }

  const gracePeriodEndsAt = toValidDate(organization?.gracePeriodEndsAt);
  if (!gracePeriodEndsAt) {
    return false;
  }

  return gracePeriodEndsAt.getTime() >= now.getTime();
}

export function shouldDowngradeToStarter(
  organization?: PlanAwareOrganizationLike | null,
  now: Date = new Date(),
): boolean {
  const contractedPlan = normalizeOrganizationPlan(organization?.plan);
  const planStatus = organization?.planStatus || 'active';

  if (contractedPlan === 'starter') {
    return false;
  }

  if (planStatus === 'canceled') {
    return true;
  }

  if (planStatus !== 'past_due') {
    return false;
  }

  return !isInGracePeriod(organization, now);
}

export function getEffectivePlan(
  organization?: PlanAwareOrganizationLike | null,
  now: Date = new Date(),
): OrganizationPlan {
  const contractedPlan = normalizeOrganizationPlan(organization?.plan);

  if (contractedPlan === 'starter') {
    return 'starter';
  }

  if (shouldDowngradeToStarter(organization, now)) {
    return 'starter';
  }

  return contractedPlan;
}

export function getAIUsageLimit(
  organization?: PlanAwareOrganizationLike | null,
  now: Date = new Date(),
): number | null {
  if (typeof organization?.aiLimit === 'number' && organization.aiLimit >= 0) {
    return organization.aiLimit;
  }

  const effectivePlan = getEffectivePlan(organization, now);

  return getPlanMonthlyAllowanceValue(effectivePlan, 'aiRequests');
}

export function getExportUsageLimit(
  organization?: PlanAwareOrganizationLike | null,
  now: Date = new Date(),
): number | null {
  if (typeof organization?.exportLimitMonthly === 'number' && organization.exportLimitMonthly >= 0) {
    return organization.exportLimitMonthly;
  }

  const effectivePlan = getEffectivePlan(organization, now);
  return getPlanMonthlyAllowanceValue(effectivePlan, 'exports');
}

export function resetAIUsageIfNeeded(
  organization?: PlanAwareOrganizationLike | null,
  now: Date = new Date(),
) {
  return resetMonthlyUsageIfNeeded({
    currentUsed: organization?.aiUsageThisMonth,
    resetAt: organization?.aiResetAt,
    now,
  });
}

export function resetExportUsageIfNeeded(
  organization?: PlanAwareOrganizationLike | null,
  now: Date = new Date(),
) {
  return resetMonthlyUsageIfNeeded({
    currentUsed: organization?.exportUsageThisMonth,
    resetAt: organization?.usageResetAt,
    now,
  });
}

export function getAIUsageStatus(
  organization?: PlanAwareOrganizationLike | null,
  now: Date = new Date(),
) {
  const effectivePlan = getEffectivePlan(organization, now);
  const usage = resetAIUsageIfNeeded(organization, now);
  const limit = getAIUsageLimit(organization, now);
  const unlimited = limit === null;
  const featureEnabled = canUsePlanFeature(effectivePlan, 'ai');
  const remaining = unlimited ? null : Math.max((limit || 0) - usage.usedThisMonth, 0);
  const reachedLimit = !unlimited && usage.usedThisMonth >= (limit || 0);
  const nearLimit =
    !unlimited &&
    (limit || 0) > 0 &&
    usage.usedThisMonth < (limit || 0) &&
    usage.usedThisMonth / (limit || 0) >= 0.8;

  return {
    effectivePlan,
    limit,
    usedThisMonth: usage.usedThisMonth,
    remaining,
    unlimited,
    resetAt: usage.resetAt,
    didReset: usage.didReset,
    featureEnabled,
    reachedLimit,
    nearLimit,
    canUse: featureEnabled && (unlimited || !reachedLimit),
  };
}

export function getExportUsageStatus(
  organization?: PlanAwareOrganizationLike | null,
  now: Date = new Date(),
) {
  const effectivePlan = getEffectivePlan(organization, now);
  const usage = resetExportUsageIfNeeded(organization, now);
  const limit = getExportUsageLimit(organization, now);
  const unlimited = limit === null;
  const featureEnabled = canUsePlanFeature(effectivePlan, 'exports');
  const remaining = unlimited ? null : Math.max((limit || 0) - usage.usedThisMonth, 0);
  const reachedLimit = !unlimited && usage.usedThisMonth >= (limit || 0);
  const nearLimit =
    !unlimited &&
    (limit || 0) > 0 &&
    usage.usedThisMonth < (limit || 0) &&
    usage.usedThisMonth / (limit || 0) >= 0.8;

  return {
    effectivePlan,
    limit,
    usedThisMonth: usage.usedThisMonth,
    remaining,
    unlimited,
    resetAt: usage.resetAt,
    didReset: usage.didReset,
    featureEnabled,
    reachedLimit,
    nearLimit,
    canUse: featureEnabled && (unlimited || !reachedLimit),
  };
}

export function canUseAI(
  organization?: PlanAwareOrganizationLike | null,
  now: Date = new Date(),
): boolean {
  return getAIUsageStatus(organization, now).canUse;
}

export function canExport(
  organization?: PlanAwareOrganizationLike | null,
  now: Date = new Date(),
): boolean {
  return getExportUsageStatus(organization, now).canUse;
}

export function incrementAIUsage(
  organization?: PlanAwareOrganizationLike | null,
  amount = 1,
  now: Date = new Date(),
) {
  const usage = getAIUsageStatus(organization, now);

  return {
    aiUsageThisMonth: Math.max(0, usage.usedThisMonth + Math.max(0, amount)),
    aiResetAt: usage.resetAt,
  };
}

export function incrementExportUsage(
  organization?: PlanAwareOrganizationLike | null,
  amount = 1,
  now: Date = new Date(),
) {
  const usage = getExportUsageStatus(organization, now);

  return {
    exportUsageThisMonth: Math.max(0, usage.usedThisMonth + Math.max(0, amount)),
    usageResetAt: usage.resetAt,
  };
}
