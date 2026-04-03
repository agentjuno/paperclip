import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyMemberships, costEvents, stripeCustomers } from "@paperclipai/db";
import type {
  BillingUsageRow,
  BillingUsageSummaryResponse,
  StripeCustomerRecord,
  StripeSubscriptionStatus,
} from "@paperclipai/shared";
import Stripe from "stripe";
import { PrivyClient } from "@privy-io/node";
import { getStripeSecretKey } from "./stripe-billing-config.js";

/* ------------------------------------------------------------------ */
/*  Lazy singletons                                                    */
/* ------------------------------------------------------------------ */

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(getStripeSecretKey());
  }
  return stripeInstance;
}

let privyInstance: PrivyClient | null = null;

function getPrivyClient(): PrivyClient {
  if (!privyInstance) {
    const appId = process.env.PRIVY_APP_ID?.trim();
    const appSecret = process.env.PRIVY_APP_SECRET?.trim();
    if (!appId || !appSecret) {
      throw new Error("Missing PRIVY_APP_ID or PRIVY_APP_SECRET for Privy SDK");
    }
    privyInstance = new PrivyClient({ appId, appSecret });
  }
  return privyInstance;
}

/* ------------------------------------------------------------------ */
/*  Unique constraint violation detection                              */
/* ------------------------------------------------------------------ */

function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as { code?: string }).code;
    // PostgreSQL unique_violation error code
    return code === "23505";
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Row → domain type mapper                                           */
/* ------------------------------------------------------------------ */

type CustomerRow = typeof stripeCustomers.$inferSelect;

function toCustomerRecord(row: CustomerRow): StripeCustomerRecord {
  return {
    id: row.id,
    privyUserId: row.privyUserId,
    stripeCustomerId: row.stripeCustomerId,
    subscriptionId: row.subscriptionId ?? null,
    subscriptionStatus: row.subscriptionStatus as StripeSubscriptionStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/*  Service factory                                                    */
/* ------------------------------------------------------------------ */

export function stripeBillingService(db: Db) {
  /**
   * Look up a customer record by Privy user ID.
   * Pure DB lookup — no external API calls.
   */
  async function getCustomerByPrivyUserId(
    privyUserId: string,
  ): Promise<StripeCustomerRecord | null> {
    const rows = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.privyUserId, privyUserId));

    return rows.length > 0 ? toCustomerRecord(rows[0]) : null;
  }

  /**
   * Get an existing Stripe customer mapping, or create a new one.
   *
   * Flow:
   * 1. Check stripe_customers table for existing mapping
   * 2. If found, return it immediately
   * 3. If not found, create customer in Stripe API (with privyUserId metadata)
   * 4. Insert mapping into DB
   * 5. Update Privy custom metadata with stripeCustomerId
   * 6. Return the new record
   *
   * Race safety: Uses DB unique constraint on privy_user_id. If a concurrent
   * call creates the row first, the insert throws a unique violation and we
   * fall back to a re-query.
   */
  async function getOrCreateCustomer(
    privyUserId: string,
    email?: string | null,
  ): Promise<StripeCustomerRecord> {
    // 1. Check for existing mapping
    const existing = await getCustomerByPrivyUserId(privyUserId);
    if (existing) {
      return existing;
    }

    // 2. Create Stripe customer via API (before any DB write)
    const stripe = getStripe();
    const stripeCustomer = await stripe.customers.create({
      ...(email ? { email } : {}),
      metadata: { privyUserId },
    });

    // 3. Insert mapping into DB — wrapped in try/catch for race safety
    try {
      const [inserted] = await db
        .insert(stripeCustomers)
        .values({
          privyUserId,
          stripeCustomerId: stripeCustomer.id,
          subscriptionStatus: "none",
        })
        .returning();

      // 4. Update Privy custom metadata (best-effort — don't fail if this errors)
      try {
        const privy = getPrivyClient();
        await privy.users().setCustomMetadata(privyUserId, {
          custom_metadata: { stripeCustomerId: stripeCustomer.id },
        });
      } catch (privyErr) {
        // Log but don't fail — the DB mapping is the source of truth
        console.error(
          `[stripe-billing] Failed to update Privy custom metadata for ${privyUserId}:`,
          privyErr instanceof Error ? privyErr.message : privyErr,
        );
      }

      return toCustomerRecord(inserted);
    } catch (insertErr) {
      // Race condition: another concurrent call inserted first
      if (isUniqueViolation(insertErr)) {
        const raceWinner = await getCustomerByPrivyUserId(privyUserId);
        if (raceWinner) {
          return raceWinner;
        }
      }
      // Re-throw if it's not a unique constraint violation
      throw insertErr;
    }
  }

  /**
   * Update the subscription status for a Stripe customer.
   * Called from webhook handler when subscription events arrive.
   */
  async function updateSubscriptionStatus(
    stripeCustomerId: string,
    subscriptionId: string | null,
    status: StripeSubscriptionStatus,
  ): Promise<StripeCustomerRecord | null> {
    const rows = await db
      .update(stripeCustomers)
      .set({
        subscriptionId,
        subscriptionStatus: status,
        updatedAt: new Date(),
      })
      .where(eq(stripeCustomers.stripeCustomerId, stripeCustomerId))
      .returning();

    return rows.length > 0 ? toCustomerRecord(rows[0]) : null;
  }

  /**
   * Aggregate cost_events across ALL companies owned by the given user
   * for the requested period. Returns per-model usage breakdown and totals.
   *
   * Used by the billing-usage endpoint to show user-level aggregated usage
   * (multi-company aggregation for single Stripe customer billing).
   */
  async function getAggregatedUsage(
    privyUserId: string,
    range?: { from?: Date; to?: Date },
  ): Promise<BillingUsageSummaryResponse> {
    // 1. Resolve all companies where this user is an active member.
    const memberRows = await db
      .select({ companyId: companyMemberships.companyId })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.principalId, privyUserId),
          eq(companyMemberships.status, "active"),
        ),
      );

    const companyIds = memberRows.map((r) => r.companyId);

    // No companies → empty usage
    if (companyIds.length === 0) {
      return { rows: [], totalTokens: 0, totalCostCents: 0, companyIds: [] };
    }

    // 2. Aggregate cost_events across those companies.
    const conditions = [inArray(costEvents.companyId, companyIds)];
    if (range?.from) conditions.push(gte(costEvents.occurredAt, range.from));
    if (range?.to) conditions.push(lte(costEvents.occurredAt, range.to));

    const rows: BillingUsageRow[] = await db
      .select({
        provider: costEvents.provider,
        model: costEvents.model,
        costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
        inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::int`,
        cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::int`,
      })
      .from(costEvents)
      .where(and(...conditions))
      .groupBy(costEvents.provider, costEvents.model)
      .orderBy(desc(sql`coalesce(sum(${costEvents.costCents}), 0)::int`));

    const totalTokens = rows.reduce(
      (sum, r) => sum + r.inputTokens + r.outputTokens + r.cachedInputTokens,
      0,
    );
    const totalCostCents = rows.reduce((sum, r) => sum + r.costCents, 0);

    return { rows, totalTokens, totalCostCents, companyIds };
  }

  return {
    getOrCreateCustomer,
    getCustomerByPrivyUserId,
    updateSubscriptionStatus,
    getAggregatedUsage,
  };
}
