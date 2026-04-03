import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyMemberships, stripeCustomers } from "@paperclipai/db";
import { isStripeBillingConfigured } from "./stripe-billing-config.js";

/**
 * Checks whether the company owner has an active subscription
 * that permits heartbeat runs.
 *
 * Returns `null` if the run should be allowed, or an error message
 * string if the run should be blocked.
 *
 * This is a LOCAL DB LOOKUP ONLY — no Stripe API calls are made.
 *
 * Graceful degradation: if STRIPE_SECRET_KEY is not configured
 * (non-billing environments), runs are always allowed.
 */
export async function checkSubscriptionAccess(
  db: Db,
  companyId: string,
): Promise<string | null> {
  // Graceful degradation: skip gating if Stripe is not configured
  if (!isStripeBillingConfigured()) {
    return null;
  }

  // 1. Resolve company owner via company_memberships.
  //    The owner is the member with membershipRole = 'owner', or the first
  //    active member if no explicit owner (earliest created member).
  const ownerRows = await db
    .select({
      principalId: companyMemberships.principalId,
    })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.status, "active"),
      ),
    )
    .orderBy(
      // Prefer 'owner' role first, then fall back to earliest created
      sql`CASE WHEN ${companyMemberships.membershipRole} = 'owner' THEN 0 ELSE 1 END`,
      asc(companyMemberships.createdAt),
    )
    .limit(1);

  if (ownerRows.length === 0) {
    return "An active subscription is required to run agents. Please set up billing to continue.";
  }

  const ownerPrivyUserId = ownerRows[0].principalId;

  // 2. Look up the owner's Stripe customer from stripe_customers table (local DB only).
  const customerRows = await db
    .select({
      subscriptionStatus: stripeCustomers.subscriptionStatus,
    })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.privyUserId, ownerPrivyUserId));

  if (customerRows.length === 0) {
    return "An active subscription is required to run agents. Please set up billing to continue.";
  }

  const { subscriptionStatus } = customerRows[0];

  // 3. Allow runs only for active or trialing subscriptions.
  if (subscriptionStatus === "active" || subscriptionStatus === "trialing") {
    return null;
  }

  // 4. Block the run with a clear message.
  return `An active subscription is required to run agents. Your current subscription status is "${subscriptionStatus}". Please update your subscription to continue.`;
}
