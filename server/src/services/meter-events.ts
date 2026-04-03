import Stripe from "stripe";
import { getStripeRestrictedKey } from "./stripe-billing-config.js";

/* ------------------------------------------------------------------ */
/*  Lazy singleton — uses STRIPE_RESTRICTED_KEY (not secret key)       */
/* ------------------------------------------------------------------ */

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(getStripeRestrictedKey());
  }
  return stripeInstance;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ReportTokenUsageParams {
  heartbeatRunId: string;
  stripeCustomerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/* ------------------------------------------------------------------ */
/*  Service factory                                                    */
/* ------------------------------------------------------------------ */

export function meterEventService() {
  /**
   * Sends meter events to Stripe for input and output token usage.
   *
   * - Sends separate events for input and output tokens.
   * - Uses `event_name = 'token-billing-tokens'`.
   * - Uses `identifier = heartbeatRunId-tokenType` for idempotency.
   * - Uses `STRIPE_RESTRICTED_KEY` (not secret key).
   * - Skips events where token count is zero.
   * - Fire-and-forget: errors are caught and logged, never thrown.
   */
  async function reportTokenUsage(params: ReportTokenUsageParams): Promise<void> {
    const {
      heartbeatRunId,
      stripeCustomerId,
      model,
      inputTokens,
      outputTokens,
    } = params;

    // Skip entirely if both token counts are zero
    if (inputTokens <= 0 && outputTokens <= 0) {
      return;
    }

    const stripe = getStripe();
    const now = Math.floor(Date.now() / 1000);

    const events: Array<{
      tokenType: "input" | "output";
      value: number;
    }> = [];

    if (inputTokens > 0) {
      events.push({ tokenType: "input", value: inputTokens });
    }

    if (outputTokens > 0) {
      events.push({ tokenType: "output", value: outputTokens });
    }

    for (const evt of events) {
      try {
        await stripe.billing.meterEvents.create({
          event_name: "token-billing-tokens",
          payload: {
            stripe_customer_id: stripeCustomerId,
            model,
            token_type: evt.tokenType,
            value: String(evt.value),
          },
          identifier: `${heartbeatRunId}-${evt.tokenType}`,
          timestamp: now,
        });
      } catch (err) {
        console.error(
          `[meter-events] Failed to send ${evt.tokenType} meter event for run ${heartbeatRunId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return {
    reportTokenUsage,
  };
}
