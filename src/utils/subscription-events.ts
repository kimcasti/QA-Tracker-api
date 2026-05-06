import type { Core } from '@strapi/strapi';

type SubscriptionEventType =
  | 'upgrade_requested'
  | 'plan_upgraded'
  | 'plan_renewed'
  | 'marked_past_due'
  | 'grace_started'
  | 'downgraded_to_starter'
  | 'plan_canceled'
  | 'manual_adjustment';

type OrganizationPlan = 'starter' | 'growth' | 'enterprise';
type OrganizationPlanStatus = 'active' | 'past_due' | 'canceled';
type PaymentMethod =
  | 'manual_transfer'
  | 'nequi'
  | 'whatsapp'
  | 'wompi'
  | 'mercadopago'
  | 'other';

type CreateSubscriptionEventInput = {
  changedByUserId?: number | null;
  eventType: SubscriptionEventType;
  organizationDocumentId: string;
  previousPlan?: OrganizationPlan | null;
  nextPlan?: OrganizationPlan | null;
  previousPlanStatus?: OrganizationPlanStatus | null;
  nextPlanStatus?: OrganizationPlanStatus | null;
  effectiveAt?: string | Date | null;
  planExpiresAt?: string | Date | null;
  gracePeriodEndsAt?: string | Date | null;
  paymentMethod?: PaymentMethod | null;
  externalReference?: string | null;
  notes?: string | null;
};

function normalizeDateValue(value?: string | Date | null) {
  if (!value) return null;
  const normalized = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(normalized.getTime())) return null;
  return normalized.toISOString();
}

function normalizeText(value?: string | null) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export async function createSubscriptionEvent(
  strapi: Core.Strapi,
  input: CreateSubscriptionEventInput,
) {
  return strapi.documents('api::subscription-event.subscription-event' as any).create({
    data: {
      eventType: input.eventType,
      previousPlan: input.previousPlan || null,
      nextPlan: input.nextPlan || null,
      previousPlanStatus: input.previousPlanStatus || null,
      nextPlanStatus: input.nextPlanStatus || null,
      effectiveAt: normalizeDateValue(input.effectiveAt),
      planExpiresAt: normalizeDateValue(input.planExpiresAt),
      gracePeriodEndsAt: normalizeDateValue(input.gracePeriodEndsAt),
      paymentMethod: input.paymentMethod || null,
      externalReference: normalizeText(input.externalReference),
      notes: normalizeText(input.notes),
      organization: input.organizationDocumentId,
      changedBy: input.changedByUserId || null,
    },
  });
}
