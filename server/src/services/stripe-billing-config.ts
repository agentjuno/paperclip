/**
 * Stripe billing configuration accessors.
 *
 * All values are read from process.env (loaded by dotenv in config.ts).
 * The pattern mirrors the Bankr config accessors in token-launch-bankr.ts.
 */

/** Returns the Stripe secret key (sk_test_... or sk_live_...). Throws if missing. */
export function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  return key;
}

/** Returns the Stripe publishable key (pk_test_... or pk_live_...). Throws if missing. */
export function getStripePublishableKey(): string {
  const key = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
  if (!key) {
    throw new Error("Missing STRIPE_PUBLISHABLE_KEY");
  }
  return key;
}

/** Returns the Stripe restricted key (rk_test_...) for meter event creation. Throws if missing. */
export function getStripeRestrictedKey(): string {
  const key = process.env.STRIPE_RESTRICTED_KEY?.trim();
  if (!key) {
    throw new Error("Missing STRIPE_RESTRICTED_KEY");
  }
  return key;
}

/** Returns the Stripe webhook signing secret (whsec_...). Throws if missing. */
export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET");
  }
  return secret;
}

/** Returns the Stripe pricing plan ID (bpp_test_...) for checkout sessions. Throws if missing. */
export function getStripePricingPlanId(): string {
  const id = process.env.STRIPE_PRICING_PLAN_ID?.trim();
  if (!id) {
    throw new Error("Missing STRIPE_PRICING_PLAN_ID");
  }
  return id;
}

/** Returns true if Stripe billing is configured (STRIPE_SECRET_KEY is set). */
export function isStripeBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}
