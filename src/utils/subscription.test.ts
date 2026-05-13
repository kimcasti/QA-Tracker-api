import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseAI,
  canUsePlanFeature,
  canUsePlanReport,
  getAIUsageStatus,
  getEffectivePlan,
  getExportUsageStatus,
  getPlanLimitValue,
  isInGracePeriod,
  normalizeOrganizationPlan,
  resetAIUsageIfNeeded,
  resetExportUsageIfNeeded,
  shouldDowngradeToStarter,
} from './subscription';

test('normalizeOrganizationPlan falls back to starter for unknown values', () => {
  assert.equal(normalizeOrganizationPlan(undefined), 'starter');
  assert.equal(normalizeOrganizationPlan(null), 'starter');
  assert.equal(normalizeOrganizationPlan('starter'), 'starter');
  assert.equal(normalizeOrganizationPlan('growth'), 'growth');
  assert.equal(normalizeOrganizationPlan('enterprise'), 'enterprise');
  assert.equal(normalizeOrganizationPlan('vip'), 'starter');
});

test('starter and growth plans expose the expected hard limits', () => {
  assert.equal(getPlanLimitValue('starter', 'projects'), 3);
  assert.equal(getPlanLimitValue('starter', 'users'), 5);
  assert.equal(getPlanLimitValue('growth', 'projects'), 15);
  assert.equal(getPlanLimitValue('growth', 'testCases'), 2000);
  assert.equal(getPlanLimitValue('enterprise', 'projects'), null);
});

test('feature and report availability follows plan tiers', () => {
  assert.equal(canUsePlanFeature('starter', 'ai'), false);
  assert.equal(canUsePlanFeature('starter', 'templates'), true);
  assert.equal(canUsePlanFeature('growth', 'ai'), true);
  assert.equal(canUsePlanFeature('enterprise', 'audit'), true);

  assert.equal(canUsePlanReport('starter', 'qaStatusSummary'), true);
  assert.equal(canUsePlanReport('starter', 'qaProgress'), false);
  assert.equal(canUsePlanReport('growth', 'deliveryUnitProgress'), true);
});

test('past due organizations remain in plan during grace period and downgrade after it ends', () => {
  const now = new Date('2026-05-13T12:00:00.000Z');
  const inGrace = {
    plan: 'growth',
    planStatus: 'past_due' as const,
    gracePeriodEndsAt: '2026-05-14T00:00:00.000Z',
  };
  const expiredGrace = {
    plan: 'growth',
    planStatus: 'past_due' as const,
    gracePeriodEndsAt: '2026-05-12T23:59:59.000Z',
  };

  assert.equal(isInGracePeriod(inGrace, now), true);
  assert.equal(shouldDowngradeToStarter(inGrace, now), false);
  assert.equal(getEffectivePlan(inGrace, now), 'growth');

  assert.equal(isInGracePeriod(expiredGrace, now), false);
  assert.equal(shouldDowngradeToStarter(expiredGrace, now), true);
  assert.equal(getEffectivePlan(expiredGrace, now), 'starter');
});

test('canceled paid plans downgrade immediately to starter', () => {
  const canceledPlan = {
    plan: 'enterprise',
    planStatus: 'canceled' as const,
  };

  assert.equal(shouldDowngradeToStarter(canceledPlan), true);
  assert.equal(getEffectivePlan(canceledPlan), 'starter');
});

test('monthly AI usage resets when reset date is missing or expired', () => {
  const now = new Date('2026-05-13T12:00:00.000Z');

  const expired = resetAIUsageIfNeeded(
    {
      aiUsageThisMonth: 9,
      aiResetAt: '2026-05-01T00:00:00.000Z',
    },
    now,
  );
  assert.equal(expired.usedThisMonth, 0);
  assert.equal(expired.didReset, true);
  assert.equal(expired.resetAt.toISOString(), '2026-06-01T00:00:00.000Z');

  const active = resetAIUsageIfNeeded(
    {
      aiUsageThisMonth: 9,
      aiResetAt: '2026-05-31T00:00:00.000Z',
    },
    now,
  );
  assert.equal(active.usedThisMonth, 9);
  assert.equal(active.didReset, false);
});

test('monthly export usage resets independently from AI usage', () => {
  const now = new Date('2026-05-13T12:00:00.000Z');

  const usage = resetExportUsageIfNeeded(
    {
      exportUsageThisMonth: 12,
      usageResetAt: '2026-05-01T00:00:00.000Z',
    },
    now,
  );

  assert.equal(usage.usedThisMonth, 0);
  assert.equal(usage.didReset, true);
  assert.equal(usage.resetAt.toISOString(), '2026-06-01T00:00:00.000Z');
});

test('AI usage status reflects disabled starter plan access', () => {
  const status = getAIUsageStatus(
    {
      plan: 'starter',
      planStatus: 'active',
      aiUsageThisMonth: 0,
      aiResetAt: '2026-05-31T00:00:00.000Z',
    },
    new Date('2026-05-13T12:00:00.000Z'),
  );

  assert.equal(status.featureEnabled, false);
  assert.equal(status.canUse, false);
  assert.equal(status.limit, 0);
  assert.equal(canUseAI({ plan: 'starter', planStatus: 'active' }), false);
});

test('AI and export usage statuses flag near-limit and reached-limit scenarios', () => {
  const now = new Date('2026-05-13T12:00:00.000Z');
  const organization = {
    plan: 'growth',
    planStatus: 'active' as const,
    aiUsageThisMonth: 40,
    aiResetAt: '2026-05-31T00:00:00.000Z',
    exportUsageThisMonth: 100,
    usageResetAt: '2026-05-31T00:00:00.000Z',
  };

  const aiStatus = getAIUsageStatus(organization, now);
  assert.equal(aiStatus.featureEnabled, true);
  assert.equal(aiStatus.limit, 50);
  assert.equal(aiStatus.nearLimit, true);
  assert.equal(aiStatus.reachedLimit, false);
  assert.equal(aiStatus.canUse, true);

  const exportStatus = getExportUsageStatus(organization, now);
  assert.equal(exportStatus.limit, 100);
  assert.equal(exportStatus.reachedLimit, true);
  assert.equal(exportStatus.canUse, false);
});

test('enterprise usage remains unlimited for AI and exports', () => {
  const status = getExportUsageStatus(
    {
      plan: 'enterprise',
      planStatus: 'active',
      exportUsageThisMonth: 999,
      usageResetAt: '2026-05-31T00:00:00.000Z',
    },
    new Date('2026-05-13T12:00:00.000Z'),
  );

  assert.equal(status.unlimited, true);
  assert.equal(status.limit, null);
  assert.equal(status.canUse, true);
});
