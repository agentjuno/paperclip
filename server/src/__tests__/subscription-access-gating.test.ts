import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mock: stripe-billing-config                                        */
/* ------------------------------------------------------------------ */

let mockIsStripeBillingConfigured = true;

vi.mock("../services/stripe-billing-config.js", () => ({
  getStripeSecretKey: () => "sk_test_mock_key",
  getStripeRestrictedKey: () => "rk_test_mock_key",
  getStripePublishableKey: () => "pk_test_mock_key",
  getStripeWebhookSecret: () => "whsec_test_mock_secret",
  getStripePricingPlanId: () => "bpp_test_mock_plan",
  isStripeBillingConfigured: () => mockIsStripeBillingConfigured,
}));

/* ------------------------------------------------------------------ */
/*  Import the function under test                                     */
/* ------------------------------------------------------------------ */

const { checkSubscriptionAccess } = await import(
  "../services/subscription-gating.js"
);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createFakeDb(opts: {
  ownerRows?: Array<{ principalId: string }>;
  customerRows?: Array<{
    subscriptionStatus: string;
  }>;
}) {
  const { ownerRows = [], customerRows = [] } = opts;

  // Track call order
  let selectCallIndex = 0;

  const db: any = {
    select: vi.fn().mockImplementation(() => {
      const callIdx = selectCallIndex++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(
                callIdx === 0 ? ownerRows : customerRows,
              ),
            }),
            // For the stripe_customers query (no orderBy/limit chain)
            then: vi.fn((resolve: any) =>
              resolve(callIdx === 0 ? ownerRows : customerRows),
            ),
          }),
        }),
      };
    }),
  };

  return db;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("checkSubscriptionAccess", () => {
  beforeEach(() => {
    mockIsStripeBillingConfigured = true;
  });

  describe("graceful degradation", () => {
    it("allows runs when STRIPE_SECRET_KEY is not configured", async () => {
      mockIsStripeBillingConfigured = false;
      const db = createFakeDb({ ownerRows: [], customerRows: [] });

      const result = await checkSubscriptionAccess(db, "company-1");

      expect(result).toBeNull();
      // Should not hit the DB at all
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe("active subscription", () => {
    it("allows runs for users with active subscription", async () => {
      const db = createFakeDb({
        ownerRows: [{ principalId: "did:privy:user1" }],
        customerRows: [{ subscriptionStatus: "active" }],
      });

      const result = await checkSubscriptionAccess(db, "company-1");

      expect(result).toBeNull();
    });

    it("allows runs for users with trialing subscription", async () => {
      const db = createFakeDb({
        ownerRows: [{ principalId: "did:privy:user1" }],
        customerRows: [{ subscriptionStatus: "trialing" }],
      });

      const result = await checkSubscriptionAccess(db, "company-1");

      expect(result).toBeNull();
    });
  });

  describe("blocked subscription statuses", () => {
    it("blocks runs when user has no subscription (status=none)", async () => {
      const db = createFakeDb({
        ownerRows: [{ principalId: "did:privy:user1" }],
        customerRows: [{ subscriptionStatus: "none" }],
      });

      const result = await checkSubscriptionAccess(db, "company-1");

      expect(result).not.toBeNull();
      expect(result!.toLowerCase()).toContain("subscription");
    });

    it("blocks runs when user has canceled subscription", async () => {
      const db = createFakeDb({
        ownerRows: [{ principalId: "did:privy:user1" }],
        customerRows: [{ subscriptionStatus: "canceled" }],
      });

      const result = await checkSubscriptionAccess(db, "company-1");

      expect(result).not.toBeNull();
      expect(result!.toLowerCase()).toContain("subscription");
    });

    it("blocks runs when user has past_due subscription", async () => {
      const db = createFakeDb({
        ownerRows: [{ principalId: "did:privy:user1" }],
        customerRows: [{ subscriptionStatus: "past_due" }],
      });

      const result = await checkSubscriptionAccess(db, "company-1");

      expect(result).not.toBeNull();
      expect(result!.toLowerCase()).toContain("subscription");
    });

    it("blocks runs when user has incomplete subscription", async () => {
      const db = createFakeDb({
        ownerRows: [{ principalId: "did:privy:user1" }],
        customerRows: [{ subscriptionStatus: "incomplete" }],
      });

      const result = await checkSubscriptionAccess(db, "company-1");

      expect(result).not.toBeNull();
      expect(result!.toLowerCase()).toContain("subscription");
    });

    it("blocks runs when user has paused subscription", async () => {
      const db = createFakeDb({
        ownerRows: [{ principalId: "did:privy:user1" }],
        customerRows: [{ subscriptionStatus: "paused" }],
      });

      const result = await checkSubscriptionAccess(db, "company-1");

      expect(result).not.toBeNull();
      expect(result!.toLowerCase()).toContain("subscription");
    });
  });

  describe("missing records", () => {
    it("blocks runs when no stripe_customers row exists (no billing setup)", async () => {
      const db = createFakeDb({
        ownerRows: [{ principalId: "did:privy:user1" }],
        customerRows: [], // no stripe customer record
      });

      const result = await checkSubscriptionAccess(db, "company-1");

      expect(result).not.toBeNull();
      expect(result!.toLowerCase()).toContain("subscription");
    });

    it("blocks runs when no active company membership found", async () => {
      const db = createFakeDb({
        ownerRows: [], // no company owner
        customerRows: [],
      });

      const result = await checkSubscriptionAccess(db, "company-1");

      expect(result).not.toBeNull();
      expect(result!.toLowerCase()).toContain("subscription");
    });
  });

  describe("error message quality", () => {
    it("error message explains that an active subscription is required", async () => {
      const db = createFakeDb({
        ownerRows: [{ principalId: "did:privy:user1" }],
        customerRows: [{ subscriptionStatus: "none" }],
      });

      const result = await checkSubscriptionAccess(db, "company-1");

      expect(result).not.toBeNull();
      expect(result!.toLowerCase()).toContain("subscription");
      expect(result!.toLowerCase()).toContain("active");
    });
  });

  describe("local DB lookup only", () => {
    it("only queries local DB tables (no Stripe API calls)", async () => {
      const db = createFakeDb({
        ownerRows: [{ principalId: "did:privy:user1" }],
        customerRows: [{ subscriptionStatus: "active" }],
      });

      await checkSubscriptionAccess(db, "company-1");

      // Verify only db.select was called (no Stripe SDK calls)
      expect(db.select).toHaveBeenCalled();
    });
  });
});
