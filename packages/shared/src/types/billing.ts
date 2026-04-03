import type { StripeSubscriptionStatus } from "../constants.js";

/** A row from the stripe_customers table */
export interface StripeCustomerRecord {
  id: number;
  privyUserId: string;
  stripeCustomerId: string;
  subscriptionId: string | null;
  subscriptionStatus: StripeSubscriptionStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Payload for creating or updating a Stripe customer mapping */
export interface UpsertStripeCustomerInput {
  privyUserId: string;
  stripeCustomerId: string;
  subscriptionId?: string | null;
  subscriptionStatus?: StripeSubscriptionStatus;
}

/** Response from GET /api/stripe/subscription-status */
export interface SubscriptionStatusResponse {
  status: StripeSubscriptionStatus;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
}

/** Response from POST /api/stripe/create-checkout */
export interface CheckoutSessionResponse {
  url: string;
  sessionId: string;
}

/** Response from POST /api/stripe/portal */
export interface PortalSessionResponse {
  url: string;
}

/** A single row in the aggregated billing usage response */
export interface BillingUsageRow {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costCents: number;
}

/**
 * Response from GET /api/stripe/billing-usage
 *
 * Aggregates cost_events across ALL companies owned by the
 * authenticated user for the requested period.
 */
export interface BillingUsageSummaryResponse {
  rows: BillingUsageRow[];
  totalTokens: number;
  totalCostCents: number;
  companyIds: string[];
}
