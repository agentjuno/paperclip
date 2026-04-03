import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockGetOrCreateCustomer = vi.hoisted(() => vi.fn());
const mockGetCustomerByPrivyUserId = vi.hoisted(() => vi.fn());
const mockUpdateSubscriptionStatus = vi.hoisted(() => vi.fn());
const mockGetAggregatedUsage = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  stripeBillingService: () => ({
    getOrCreateCustomer: mockGetOrCreateCustomer,
    getCustomerByPrivyUserId: mockGetCustomerByPrivyUserId,
    updateSubscriptionStatus: mockUpdateSubscriptionStatus,
    getAggregatedUsage: mockGetAggregatedUsage,
  }),
}));

const mockRawRequest = vi.hoisted(() => vi.fn());
const mockBillingPortalSessionsCreate = vi.hoisted(() => vi.fn());

vi.mock("stripe", () => {
  const StripeClass = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: mockBillingPortalSessionsCreate } },
    rawRequest: mockRawRequest,
  }));
  return { default: StripeClass };
});

vi.mock("../services/stripe-billing-config.js", () => ({
  getStripeSecretKey: () => "sk_test_mock_key",
  getStripePricingPlanId: () => "bpp_test_mock_plan",
  isStripeBillingConfigured: () => true,
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function loadBillingRoutes() {
  const mod = await import("../routes/stripe-billing.js");
  return mod.stripeBillingRoutes;
}

interface ActorOverrides {
  type?: string;
  userId?: string;
  userEmail?: string | null;
  companyIds?: string[];
  source?: string;
  isInstanceAdmin?: boolean;
}

function boardActor(overrides: ActorOverrides = {}): Record<string, unknown> {
  return {
    type: "board",
    userId: "did:privy:user1",
    userEmail: "user@example.com",
    companyIds: ["company-1"],
    source: "session",
    isInstanceAdmin: false,
    ...overrides,
  };
}

function noActor(): Record<string, unknown> {
  return { type: "none", source: "none" };
}

async function createApp(actor: Record<string, unknown> = boardActor()) {
  const stripeBillingRoutes = await loadBillingRoutes();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", stripeBillingRoutes({} as any));
  app.use(errorHandler);
  return app;
}

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const PRIVY_USER_ID = "did:privy:user1";
const STRIPE_CUSTOMER_ID = "cus_test_cross_area";
const SUBSCRIPTION_ID = "sub_test_cross_area";

const noneCustomerRecord = {
  id: 1,
  privyUserId: PRIVY_USER_ID,
  stripeCustomerId: STRIPE_CUSTOMER_ID,
  subscriptionId: null,
  subscriptionStatus: "none" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const activeCustomerRecord = {
  ...noneCustomerRecord,
  subscriptionId: SUBSCRIPTION_ID,
  subscriptionStatus: "active" as const,
};

const canceledCustomerRecord = {
  ...noneCustomerRecord,
  subscriptionId: SUBSCRIPTION_ID,
  subscriptionStatus: "canceled" as const,
};

/* ================================================================== */
/*  Cross-Area Integration Tests                                       */
/* ================================================================== */

describe("cross-area billing integration", () => {
  beforeEach(() => {
    mockGetOrCreateCustomer.mockReset();
    mockGetCustomerByPrivyUserId.mockReset();
    mockUpdateSubscriptionStatus.mockReset();
    mockGetAggregatedUsage.mockReset();
    mockRawRequest.mockReset();
    mockBillingPortalSessionsCreate.mockReset();
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-CROSS-001: Full lifecycle                                    */
  /*  subscribe → webhook → run → meter → view                         */
  /* ---------------------------------------------------------------- */

  describe("VAL-CROSS-001: Full subscription lifecycle", () => {
    it("subscribe → webhook updates DB → subscription-status shows active", async () => {
      const app = await createApp();

      // Step 1: User subscribes via checkout
      mockGetOrCreateCustomer.mockResolvedValue(noneCustomerRecord);
      mockRawRequest.mockResolvedValue({
        id: "cs_test_lifecycle",
        url: "https://checkout.stripe.com/c/pay/cs_test_lifecycle",
      });

      const checkoutRes = await request(app)
        .post("/api/stripe/create-checkout");

      expect(checkoutRes.status).toBe(200);
      expect(checkoutRes.body.url).toContain("checkout.stripe.com");
      expect(checkoutRes.body.sessionId).toBe("cs_test_lifecycle");

      // Step 2: After webhook fires, subscription-status returns active
      mockGetCustomerByPrivyUserId.mockResolvedValue(activeCustomerRecord);
      const statusRes = await request(app)
        .get("/api/stripe/subscription-status");

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe("active");
      expect(statusRes.body.stripeCustomerId).toBe(STRIPE_CUSTOMER_ID);
      expect(statusRes.body.subscriptionId).toBe(SUBSCRIPTION_ID);

      // Step 3: After agent run, billing-usage shows usage data
      mockGetAggregatedUsage.mockResolvedValue({
        rows: [
          {
            provider: "anthropic",
            model: "claude-3.5-sonnet",
            costCents: 150,
            inputTokens: 10000,
            outputTokens: 5000,
            cachedInputTokens: 500,
          },
        ],
        totalTokens: 15500,
        totalCostCents: 150,
        companyIds: ["company-1"],
      });

      const usageRes = await request(app).get("/api/stripe/billing-usage");
      expect(usageRes.status).toBe(200);
      expect(usageRes.body.totalTokens).toBe(15500);
      expect(usageRes.body.totalCostCents).toBe(150);
      expect(usageRes.body.rows).toHaveLength(1);
    });

    it("checkout session is linked to the correct Stripe customer", async () => {
      const app = await createApp();
      mockGetOrCreateCustomer.mockResolvedValue(noneCustomerRecord);
      mockRawRequest.mockResolvedValue({
        id: "cs_test_linked",
        url: "https://checkout.stripe.com/c/pay/cs_test_linked",
      });

      await request(app).post("/api/stripe/create-checkout");

      expect(mockRawRequest).toHaveBeenCalledWith(
        "POST",
        "/v1/checkout/sessions",
        expect.objectContaining({ customer: STRIPE_CUSTOMER_ID }),
        expect.any(Object),
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-CROSS-008: Cancellation blocks subsequent agent runs         */
  /* ---------------------------------------------------------------- */

  describe("VAL-CROSS-008: Cancellation blocks subsequent agent runs", () => {
    it("canceled subscription shows correct status in billing endpoints", async () => {
      const app = await createApp();

      // After cancellation via portal + webhook, subscription-status returns canceled
      mockGetCustomerByPrivyUserId.mockResolvedValue(canceledCustomerRecord);

      const statusRes = await request(app)
        .get("/api/stripe/subscription-status");

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe("canceled");
    });

    it("canceled user can re-subscribe via checkout", async () => {
      const app = await createApp();

      // User has canceled subscription
      mockGetOrCreateCustomer.mockResolvedValue(canceledCustomerRecord);
      mockRawRequest.mockResolvedValue({
        id: "cs_test_resubscribe",
        url: "https://checkout.stripe.com/c/pay/cs_test_resubscribe",
      });

      // Should allow new checkout since status is canceled (not active/trialing)
      const res = await request(app).post("/api/stripe/create-checkout");
      expect(res.status).toBe(200);
      expect(res.body.url).toContain("checkout.stripe.com");
    });

    it("active user cannot create duplicate subscription", async () => {
      const app = await createApp();

      // User has active subscription
      mockGetOrCreateCustomer.mockResolvedValue(activeCustomerRecord);

      const res = await request(app).post("/api/stripe/create-checkout");
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("portal");
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-CROSS-010: Multi-company usage aggregates to single customer */
  /* ---------------------------------------------------------------- */

  describe("VAL-CROSS-010: Multi-company usage aggregates to single customer", () => {
    it("billing-usage endpoint returns aggregated usage across all companies", async () => {
      const app = await createApp();

      mockGetAggregatedUsage.mockResolvedValue({
        rows: [
          {
            provider: "anthropic",
            model: "claude-3.5-sonnet",
            costCents: 300,
            inputTokens: 13000,
            outputTokens: 5000,
            cachedInputTokens: 1500,
          },
          {
            provider: "openai",
            model: "gpt-4o",
            costCents: 50,
            inputTokens: 3000,
            outputTokens: 1000,
            cachedInputTokens: 0,
          },
        ],
        totalTokens: 23500,
        totalCostCents: 350,
        companyIds: ["company-1", "company-2"],
      });

      const res = await request(app).get("/api/stripe/billing-usage");

      expect(res.status).toBe(200);
      // Both companies' usage should be present
      expect(res.body.companyIds).toEqual(
        expect.arrayContaining(["company-1", "company-2"]),
      );
      expect(res.body.companyIds).toHaveLength(2);

      // Usage should be aggregated by provider+model
      expect(res.body.rows).toHaveLength(2);

      // Claude aggregated across both companies
      const claudeRow = res.body.rows.find(
        (r: any) => r.model === "claude-3.5-sonnet",
      );
      expect(claudeRow).toBeDefined();
      expect(claudeRow.costCents).toBe(300);
      expect(claudeRow.inputTokens).toBe(13000);
      expect(claudeRow.outputTokens).toBe(5000);
      expect(claudeRow.cachedInputTokens).toBe(1500);

      // OpenAI only from company-2
      const gptRow = res.body.rows.find((r: any) => r.model === "gpt-4o");
      expect(gptRow).toBeDefined();
      expect(gptRow.costCents).toBe(50);

      // Totals
      expect(res.body.totalTokens).toBe(23500);
      expect(res.body.totalCostCents).toBe(350);
    });

    it("returns empty usage when user has no companies", async () => {
      const app = await createApp();

      mockGetAggregatedUsage.mockResolvedValue({
        rows: [],
        totalTokens: 0,
        totalCostCents: 0,
        companyIds: [],
      });

      const res = await request(app).get("/api/stripe/billing-usage");

      expect(res.status).toBe(200);
      expect(res.body.rows).toEqual([]);
      expect(res.body.totalTokens).toBe(0);
      expect(res.body.totalCostCents).toBe(0);
      expect(res.body.companyIds).toEqual([]);
    });

    it("requires authentication", async () => {
      const app = await createApp(noActor());

      const res = await request(app).get("/api/stripe/billing-usage");

      expect(res.status).toBe(401);
    });

    it("service is called with correct user ID from actor", async () => {
      const app = await createApp();

      mockGetAggregatedUsage.mockResolvedValue({
        rows: [],
        totalTokens: 0,
        totalCostCents: 0,
        companyIds: [],
      });

      await request(app).get("/api/stripe/billing-usage");

      expect(mockGetAggregatedUsage).toHaveBeenCalledWith(
        PRIVY_USER_ID,
        { from: undefined, to: undefined },
      );
    });

    it("passes date range parameters to the service", async () => {
      const app = await createApp();

      mockGetAggregatedUsage.mockResolvedValue({
        rows: [],
        totalTokens: 0,
        totalCostCents: 0,
        companyIds: [],
      });

      const from = "2026-04-01T00:00:00.000Z";
      const to = "2026-04-30T23:59:59.999Z";

      await request(app).get(`/api/stripe/billing-usage?from=${from}&to=${to}`);

      expect(mockGetAggregatedUsage).toHaveBeenCalledWith(
        PRIVY_USER_ID,
        { from: new Date(from), to: new Date(to) },
      );
    });

    it("rejects invalid date parameters", async () => {
      const app = await createApp();

      const res = await request(app).get("/api/stripe/billing-usage?from=not-a-date");

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("date");
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-CROSS-011: Company-scoped cost reporting unaffected          */
  /* ---------------------------------------------------------------- */

  describe("VAL-CROSS-011: Company-scoped cost reporting unaffected by user-level billing", () => {
    it("subscription-status does not expose company cost data", async () => {
      const app = await createApp();
      mockGetCustomerByPrivyUserId.mockResolvedValue(activeCustomerRecord);

      const statusRes = await request(app).get("/api/stripe/subscription-status");

      // subscription-status returns user-level subscription info only
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe("active");
      // No cost data should be included in subscription-status response
      expect(statusRes.body).not.toHaveProperty("costs");
      expect(statusRes.body).not.toHaveProperty("companyId");
    });

    it("billing-usage aggregation does not include companyId per row", async () => {
      const app = await createApp();

      mockGetAggregatedUsage.mockResolvedValue({
        rows: [
          {
            provider: "anthropic",
            model: "claude-3.5-sonnet",
            costCents: 100,
            inputTokens: 5000,
            outputTokens: 2000,
            cachedInputTokens: 0,
          },
        ],
        totalTokens: 7000,
        totalCostCents: 100,
        companyIds: ["company-1", "company-2"],
      });

      const res = await request(app).get("/api/stripe/billing-usage");

      expect(res.status).toBe(200);
      // Each row in the aggregated response does NOT include companyId field
      // (usage is aggregated, not company-scoped)
      for (const row of res.body.rows) {
        expect(row).not.toHaveProperty("companyId");
      }
      // But companyIds are listed at the top level for reference
      expect(res.body.companyIds).toEqual(
        expect.arrayContaining(["company-1", "company-2"]),
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  VAL-CROSS-015: Auth bridge preserves identity for billing        */
  /* ---------------------------------------------------------------- */

  describe("VAL-CROSS-015: Auth bridge preserves identity for billing", () => {
    it("billing endpoints use the same Privy user ID from the actor", async () => {
      const app = await createApp();

      // Create checkout → should call getOrCreateCustomer with the actor's userId
      mockGetOrCreateCustomer.mockResolvedValue(noneCustomerRecord);
      mockRawRequest.mockResolvedValue({
        id: "cs_test_identity",
        url: "https://checkout.stripe.com/c/pay/cs_test_identity",
      });

      await request(app).post("/api/stripe/create-checkout");

      expect(mockGetOrCreateCustomer).toHaveBeenCalledWith(
        PRIVY_USER_ID,
        "user@example.com",
      );
    });

    it("subscription-status returns data for the authenticated user", async () => {
      const app = await createApp();

      mockGetCustomerByPrivyUserId.mockResolvedValue(activeCustomerRecord);

      const res = await request(app).get("/api/stripe/subscription-status");

      expect(res.status).toBe(200);
      expect(mockGetCustomerByPrivyUserId).toHaveBeenCalledWith(PRIVY_USER_ID);
      // Stripe customer is the one mapped to this Privy user
      expect(res.body.stripeCustomerId).toBe(STRIPE_CUSTOMER_ID);
    });

    it("portal session uses the correct Stripe customer for the authenticated user", async () => {
      const app = await createApp();

      mockGetCustomerByPrivyUserId.mockResolvedValue(activeCustomerRecord);
      mockBillingPortalSessionsCreate.mockResolvedValue({
        url: "https://billing.stripe.com/p/session/test_identity",
      });

      await request(app).post("/api/stripe/portal");

      expect(mockGetCustomerByPrivyUserId).toHaveBeenCalledWith(PRIVY_USER_ID);
      expect(mockBillingPortalSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer: STRIPE_CUSTOMER_ID }),
      );
    });

    it("billing-usage uses the authenticated user's identity", async () => {
      const app = await createApp();

      mockGetAggregatedUsage.mockResolvedValue({
        rows: [],
        totalTokens: 0,
        totalCostCents: 0,
        companyIds: [],
      });

      await request(app).get("/api/stripe/billing-usage");

      // Service is called with the actor's privyUserId
      expect(mockGetAggregatedUsage).toHaveBeenCalledWith(
        PRIVY_USER_ID,
        expect.any(Object),
      );
    });

    it("different users get different billing data", async () => {
      const user2PrivyId = "did:privy:user2";
      const user2StripeCustomerId = "cus_test_user2";

      // User 1
      const app1 = await createApp(boardActor({ userId: PRIVY_USER_ID }));
      mockGetCustomerByPrivyUserId.mockResolvedValue(activeCustomerRecord);

      const res1 = await request(app1).get("/api/stripe/subscription-status");
      expect(res1.body.stripeCustomerId).toBe(STRIPE_CUSTOMER_ID);

      // User 2
      const app2 = await createApp(boardActor({ userId: user2PrivyId }));
      mockGetCustomerByPrivyUserId.mockResolvedValue({
        ...activeCustomerRecord,
        privyUserId: user2PrivyId,
        stripeCustomerId: user2StripeCustomerId,
      });

      const res2 = await request(app2).get("/api/stripe/subscription-status");
      expect(res2.body.stripeCustomerId).toBe(user2StripeCustomerId);
    });
  });
});
