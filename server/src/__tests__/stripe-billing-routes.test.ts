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

vi.mock("../services/index.js", () => ({
  stripeBillingService: () => ({
    getOrCreateCustomer: mockGetOrCreateCustomer,
    getCustomerByPrivyUserId: mockGetCustomerByPrivyUserId,
    updateSubscriptionStatus: mockUpdateSubscriptionStatus,
  }),
}));

const mockCheckoutSessionsCreate = vi.hoisted(() => vi.fn());
const mockBillingPortalSessionsCreate = vi.hoisted(() => vi.fn());
const mockRawRequest = vi.hoisted(() => vi.fn());

vi.mock("stripe", () => {
  const StripeClass = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockCheckoutSessionsCreate } },
    billingPortal: { sessions: { create: mockBillingPortalSessionsCreate } },
    rawRequest: mockRawRequest,
  }));
  return { default: StripeClass };
});

vi.mock("../services/stripe-billing-config.js", () => ({
  getStripeSecretKey: () => "sk_test_mock_key",
  getStripePricingPlanId: () => "bpp_test_mock_plan",
  getStripePricingPlanVersion: () => "bppv_test_mock_version",
  isStripeBillingConfigured: () => true,
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function loadRoutes() {
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
  const stripeBillingRoutes = await loadRoutes();
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
const STRIPE_CUSTOMER_ID = "cus_test_abc123";

const activeCustomerRecord = {
  id: 1,
  privyUserId: PRIVY_USER_ID,
  stripeCustomerId: STRIPE_CUSTOMER_ID,
  subscriptionId: "sub_active_123",
  subscriptionStatus: "active" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const noneCustomerRecord = {
  id: 2,
  privyUserId: PRIVY_USER_ID,
  stripeCustomerId: STRIPE_CUSTOMER_ID,
  subscriptionId: null,
  subscriptionStatus: "none" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe("stripe-billing routes", () => {
  beforeEach(() => {
    // Only clear call tracking — don't clear implementations
    mockGetOrCreateCustomer.mockClear();
    mockGetCustomerByPrivyUserId.mockClear();
    mockUpdateSubscriptionStatus.mockClear();
    mockCheckoutSessionsCreate.mockClear();
    mockBillingPortalSessionsCreate.mockClear();
    mockRawRequest.mockClear();
  });

  /* ---------------------------------------------------------------- */
  /*  POST /api/stripe/create-checkout                                 */
  /* ---------------------------------------------------------------- */

  describe("POST /api/stripe/create-checkout", () => {
    it("returns 401 without valid auth session", async () => {
      const app = await createApp(noActor());
      const res = await request(app).post("/api/stripe/create-checkout");
      expect(res.status).toBe(401);
    });

    it("returns {url, sessionId} for new subscriber", async () => {
      const app = await createApp();

      mockGetOrCreateCustomer.mockResolvedValue(noneCustomerRecord);

      mockRawRequest.mockResolvedValue({
        id: "cs_test_session123",
        url: "https://checkout.stripe.com/c/pay/cs_test_session123",
      });

      const res = await request(app).post("/api/stripe/create-checkout");

      expect(res.status).toBe(200);
      expect(res.body.url).toContain("checkout.stripe.com");
      expect(res.body.sessionId).toBe("cs_test_session123");
    });

    it("links checkout session to correct Stripe customer", async () => {
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
        expect.objectContaining({
          customer: STRIPE_CUSTOMER_ID,
        }),
        expect.any(Object),
      );
    });

    it("uses the correct pricing plan and version from config", async () => {
      const app = await createApp();

      mockGetOrCreateCustomer.mockResolvedValue(noneCustomerRecord);

      mockRawRequest.mockResolvedValue({
        id: "cs_test_plan",
        url: "https://checkout.stripe.com/c/pay/cs_test_plan",
      });

      await request(app).post("/api/stripe/create-checkout");

      expect(mockRawRequest).toHaveBeenCalledWith(
        "POST",
        "/v1/checkout/sessions",
        expect.objectContaining({
          "checkout_items[0][type]": "pricing_plan_subscription_item",
          "checkout_items[0][pricing_plan_subscription_item][pricing_plan]":
            "bpp_test_mock_plan",
          "checkout_items[0][pricing_plan_subscription_item][pricing_plan_version]":
            "bppv_test_mock_version",
        }),
        expect.any(Object),
      );
    });

    it("sends the correct Stripe-Version header for preview API", async () => {
      const app = await createApp();

      mockGetOrCreateCustomer.mockResolvedValue(noneCustomerRecord);

      mockRawRequest.mockResolvedValue({
        id: "cs_test_version",
        url: "https://checkout.stripe.com/c/pay/cs_test_version",
      });

      await request(app).post("/api/stripe/create-checkout");

      expect(mockRawRequest).toHaveBeenCalledWith(
        "POST",
        "/v1/checkout/sessions",
        expect.any(Object),
        expect.objectContaining({
          additionalHeaders: expect.objectContaining({
            "Stripe-Version":
              "2025-09-30.preview;checkout_product_catalog_preview=v1",
          }),
        }),
      );
    });

    it("returns error for already-subscribed users", async () => {
      const app = await createApp();

      mockGetOrCreateCustomer.mockResolvedValue(activeCustomerRecord);

      const res = await request(app).post("/api/stripe/create-checkout");

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("portal");
      // Should NOT attempt to create a checkout session
      expect(mockRawRequest).not.toHaveBeenCalled();
    });

    it("handles Stripe API errors gracefully", async () => {
      const app = await createApp();

      mockGetOrCreateCustomer.mockResolvedValue(noneCustomerRecord);
      mockRawRequest.mockRejectedValue(new Error("Stripe API error"));

      const res = await request(app).post("/api/stripe/create-checkout");

      expect(res.status).toBe(502);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  POST /api/stripe/portal                                          */
  /* ---------------------------------------------------------------- */

  describe("POST /api/stripe/portal", () => {
    it("returns 401 without valid auth session", async () => {
      const app = await createApp(noActor());
      const res = await request(app).post("/api/stripe/portal");
      expect(res.status).toBe(401);
    });

    it("returns {url} with billing.stripe.com URL", async () => {
      const app = await createApp();

      mockGetCustomerByPrivyUserId.mockResolvedValue(activeCustomerRecord);
      mockBillingPortalSessionsCreate.mockResolvedValue({
        url: "https://billing.stripe.com/p/session/test_session",
      });

      const res = await request(app).post("/api/stripe/portal");

      expect(res.status).toBe(200);
      expect(res.body.url).toContain("billing.stripe.com");
    });

    it("returns 404 when user has no Stripe customer", async () => {
      const app = await createApp();

      mockGetCustomerByPrivyUserId.mockResolvedValue(null);

      const res = await request(app).post("/api/stripe/portal");

      expect(res.status).toBe(404);
      expect(res.body.error).toBeTruthy();
    });

    it("creates portal session with correct customer ID", async () => {
      const app = await createApp();

      mockGetCustomerByPrivyUserId.mockResolvedValue(activeCustomerRecord);
      mockBillingPortalSessionsCreate.mockResolvedValue({
        url: "https://billing.stripe.com/p/session/test_correct",
      });

      await request(app).post("/api/stripe/portal");

      expect(mockBillingPortalSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: STRIPE_CUSTOMER_ID,
        }),
      );
    });

    it("handles Stripe API errors gracefully", async () => {
      const app = await createApp();

      mockGetCustomerByPrivyUserId.mockResolvedValue(activeCustomerRecord);
      mockBillingPortalSessionsCreate.mockRejectedValue(
        new Error("Portal API error"),
      );

      const res = await request(app).post("/api/stripe/portal");

      expect(res.status).toBe(502);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  GET /api/stripe/subscription-status                              */
  /* ---------------------------------------------------------------- */

  describe("GET /api/stripe/subscription-status", () => {
    it("returns 401 without valid auth session", async () => {
      const app = await createApp(noActor());
      const res = await request(app).get("/api/stripe/subscription-status");
      expect(res.status).toBe(401);
    });

    it("returns current subscription state for subscribed user", async () => {
      const app = await createApp();

      mockGetCustomerByPrivyUserId.mockResolvedValue(activeCustomerRecord);

      const res = await request(app).get("/api/stripe/subscription-status");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("active");
      expect(res.body.stripeCustomerId).toBe(STRIPE_CUSTOMER_ID);
      expect(res.body.subscriptionId).toBe("sub_active_123");
    });

    it('returns status="none" for unsubscribed users', async () => {
      const app = await createApp();

      mockGetCustomerByPrivyUserId.mockResolvedValue(null);

      const res = await request(app).get("/api/stripe/subscription-status");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("none");
      expect(res.body.stripeCustomerId).toBeNull();
      expect(res.body.subscriptionId).toBeNull();
    });

    it('returns status="none" for user with customer but no subscription', async () => {
      const app = await createApp();

      mockGetCustomerByPrivyUserId.mockResolvedValue(noneCustomerRecord);

      const res = await request(app).get("/api/stripe/subscription-status");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("none");
      expect(res.body.stripeCustomerId).toBe(STRIPE_CUSTOMER_ID);
      expect(res.body.subscriptionId).toBeNull();
    });
  });
});
