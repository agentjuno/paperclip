import type {
  SubscriptionStatusResponse,
  CheckoutSessionResponse,
  PortalSessionResponse,
  BillingUsageRow as SharedBillingUsageRow,
  BillingUsageSummaryResponse,
} from "@paperclipai/shared";
import { api } from "./client";

/** Per-model usage row returned by the billing usage endpoint or costs breakdown. */
export interface BillingUsageRow {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costCents: number;
}

/** Aggregate billing usage summary for the current period. */
export interface BillingUsageSummary {
  rows: BillingUsageRow[];
  totalTokens: number;
  totalCostCents: number;
}

export const billingApi = {
  /** GET /api/stripe/subscription-status — current user's subscription state. */
  getSubscriptionStatus: () =>
    api.get<SubscriptionStatusResponse>("/stripe/subscription-status"),

  /** POST /api/stripe/create-checkout — create a Stripe Checkout session. */
  createCheckoutSession: () =>
    api.post<CheckoutSessionResponse>("/stripe/create-checkout", {}),

  /** POST /api/stripe/portal — create a Stripe Billing Portal session. */
  createPortalSession: () =>
    api.post<PortalSessionResponse>("/stripe/portal", {}),

  /**
   * Fetch per-model usage for a company in the current billing period.
   * Re-uses the existing costs by-provider endpoint.
   */
  getUsageSummary: (companyId: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    const suffix = qs ? `?${qs}` : "";
    return api
      .get<BillingUsageRow[]>(
        `/companies/${encodeURIComponent(companyId)}/costs/by-provider${suffix}`,
      )
      .then((rows): BillingUsageSummary => {
        const totalTokens = rows.reduce(
          (sum, r) => sum + r.inputTokens + r.outputTokens + r.cachedInputTokens,
          0,
        );
        const totalCostCents = rows.reduce((sum, r) => sum + r.costCents, 0);
        return { rows, totalTokens, totalCostCents };
      });
  },

  /**
   * Fetch aggregated per-model usage across ALL companies owned by the
   * authenticated user. Used by the billing tab for user-level billing view.
   */
  getAggregatedUsage: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    const suffix = qs ? `?${qs}` : "";
    return api.get<BillingUsageSummaryResponse>(`/stripe/billing-usage${suffix}`);
  },
};
