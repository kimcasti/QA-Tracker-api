export const STARTER_PROJECT_LIMIT = 4;
export const PRO_PLAN_PRICE_MONTHLY_USD = 5;

export type OrganizationPlan = 'starter' | 'growth' | 'enterprise';

export function normalizeOrganizationPlan(plan?: string | null): OrganizationPlan {
  if (plan === 'growth' || plan === 'enterprise') {
    return plan;
  }

  return 'starter';
}

export function getProjectLimitForPlan(plan?: string | null) {
  return normalizeOrganizationPlan(plan) === 'starter' ? STARTER_PROJECT_LIMIT : null;
}
