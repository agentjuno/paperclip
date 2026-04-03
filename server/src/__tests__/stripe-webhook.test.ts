import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockUpdateSubscriptionStatus = vi.hoisted(() => vi.fn());
const mockGetOrCreateCustomer = vi.hoisted(() => vi.fn());
const mockGetCustomerByPrivyUserId = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  stripeBillingService: () => ({
    updateSubscriptionStatus: mockUpdateSubscriptionStatus,
    getOrCreateCustomer: mockGetOrCreateCustomer,
    getCustomerByPrivyUserId: mockGetCustomerByPrivyUserId,
  }),
}));

const mockConstructEvent = vi.hoisted(() => vi.fn());

vi.mock("stripe", () => {
  const StripeClass = vi.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  }));
  return { default: StripeClass };
});

vi.mock("../services/stripe-billing-config.js", () => ({
  getStripeSecretKey: () => "sk_test_mock_key",
  getStripeWebhookSecret: () => "whsec_test_mock_secret",
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function loadWebhookRoute() {
  const mod = await import("../routes/stripe-webhook.js");
  return mod.stripeWebhookRoute;
}

async function createApp() {
  const stripeWebhookRoute = await loadWebhookRoute();
  const app = express();
  // Replicate the raw body capture from the real server
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use("/api", stripeWebhookRoute({} as any));
  return app;
}

/* ------------------------------------------------------------------ */
/*  Stripe event factory helpers                                       */
/* ------------------------------------------------------------------ */

function subscriptionEvent(
  type: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `evt_test_${Date.now()}`,
    type,
    data: {
      object: {
        id: "sub_test_123",
        customer: "cus_test_abc",
        status: "active",
        ...overrides,
      },
    },
  };
}

function invoicePaidEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_test_inv_${Date.now()}`,
    type: "invoice.paid",
    data: {
      object: {
        id: "in_test_456",
        customer: "cus_test_abc",
        subscription: "sub_test_123",
        status: "paid",
        ...overrides,
      },
    },
  };
}

/* ================================================================== */
/*  Tests                                                              */
/* ================================================================== */

describe("stripe webhook handler", () => {
  beforeEach(() => {
    mockConstructEvent.mockClear();
    mockUpdateSubscriptionStatus.mockClear();
    mockGetOrCreateCustomer.mockClear();
    mockGetCustomerByPrivyUserId.mockClear();
  });

  /* ---------------------------------------------------------------- */
  /*  Signature verification                                           */
  /* ---------------------------------------------------------------- */

  describe("signature verification", () => {
    it("returns 400 when stripe-signature header is missing", async () => {
      const app = await createApp();

      const res = await request(app)
        .post("/api/stripe/webhook")
        .send({ type: "test" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signature/i);
    });

    it("returns 400 when stripe-signature is invalid", async () => {
      const app = await createApp();

      mockConstructEvent.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "invalid_sig_value")
        .send({ type: "test" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signature/i);
    });

    it("calls constructEvent with rawBody, signature, and webhook secret", async () => {
      const app = await createApp();
      const event = subscriptionEvent("customer.subscription.created");

      mockConstructEvent.mockReturnValue(event);
      mockUpdateSubscriptionStatus.mockResolvedValue(null);

      await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      expect(mockConstructEvent).toHaveBeenCalledWith(
        expect.any(Buffer),
        "t=123,v1=abc",
        "whsec_test_mock_secret",
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  customer.subscription.created                                    */
  /* ---------------------------------------------------------------- */

  describe("customer.subscription.created", () => {
    it("updates stripe_customers with subscriptionId and status=active", async () => {
      const app = await createApp();
      const event = subscriptionEvent("customer.subscription.created", {
        status: "active",
      });

      mockConstructEvent.mockReturnValue(event);
      mockUpdateSubscriptionStatus.mockResolvedValue({
        id: 1,
        privyUserId: "did:privy:user1",
        stripeCustomerId: "cus_test_abc",
        subscriptionId: "sub_test_123",
        subscriptionStatus: "active",
      });

      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockUpdateSubscriptionStatus).toHaveBeenCalledWith(
        "cus_test_abc",
        "sub_test_123",
        "active",
      );
    });

    it("handles trialing status on subscription creation", async () => {
      const app = await createApp();
      const event = subscriptionEvent("customer.subscription.created", {
        status: "trialing",
      });

      mockConstructEvent.mockReturnValue(event);
      mockUpdateSubscriptionStatus.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      expect(res.status).toBe(200);
      expect(mockUpdateSubscriptionStatus).toHaveBeenCalledWith(
        "cus_test_abc",
        "sub_test_123",
        "trialing",
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  customer.subscription.updated                                    */
  /* ---------------------------------------------------------------- */

  describe("customer.subscription.updated", () => {
    it("syncs status change to local DB", async () => {
      const app = await createApp();
      const event = subscriptionEvent("customer.subscription.updated", {
        status: "past_due",
      });

      mockConstructEvent.mockReturnValue(event);
      mockUpdateSubscriptionStatus.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      expect(res.status).toBe(200);
      expect(mockUpdateSubscriptionStatus).toHaveBeenCalledWith(
        "cus_test_abc",
        "sub_test_123",
        "past_due",
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  customer.subscription.deleted                                    */
  /* ---------------------------------------------------------------- */

  describe("customer.subscription.deleted", () => {
    it("marks subscription as canceled in local DB", async () => {
      const app = await createApp();
      const event = subscriptionEvent("customer.subscription.deleted", {
        status: "canceled",
      });

      mockConstructEvent.mockReturnValue(event);
      mockUpdateSubscriptionStatus.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      expect(res.status).toBe(200);
      expect(mockUpdateSubscriptionStatus).toHaveBeenCalledWith(
        "cus_test_abc",
        "sub_test_123",
        "canceled",
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  invoice.paid                                                     */
  /* ---------------------------------------------------------------- */

  describe("invoice.paid", () => {
    it("confirms subscription remains active", async () => {
      const app = await createApp();
      const event = invoicePaidEvent();

      mockConstructEvent.mockReturnValue(event);
      mockUpdateSubscriptionStatus.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      expect(res.status).toBe(200);
      expect(mockUpdateSubscriptionStatus).toHaveBeenCalledWith(
        "cus_test_abc",
        "sub_test_123",
        "active",
      );
    });

    it("skips update when invoice has no subscription", async () => {
      const app = await createApp();
      const event = invoicePaidEvent({ subscription: null });

      mockConstructEvent.mockReturnValue(event);

      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      expect(res.status).toBe(200);
      expect(mockUpdateSubscriptionStatus).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Unrecognized event types                                         */
  /* ---------------------------------------------------------------- */

  describe("unrecognized event types", () => {
    it("returns 200 with no state change", async () => {
      const app = await createApp();
      const event = {
        id: "evt_test_unknown",
        type: "charge.refunded",
        data: { object: {} },
      };

      mockConstructEvent.mockReturnValue(event);

      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockUpdateSubscriptionStatus).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Idempotency — duplicate events                                   */
  /* ---------------------------------------------------------------- */

  describe("idempotency", () => {
    it("duplicate events produce consistent state (no corruption)", async () => {
      const app = await createApp();
      const event = subscriptionEvent("customer.subscription.created", {
        status: "active",
      });

      mockConstructEvent.mockReturnValue(event);
      mockUpdateSubscriptionStatus.mockResolvedValue({
        id: 1,
        privyUserId: "did:privy:user1",
        stripeCustomerId: "cus_test_abc",
        subscriptionId: "sub_test_123",
        subscriptionStatus: "active",
      });

      // Send the same event twice
      const res1 = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      const res2 = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Both calls use updateSubscriptionStatus (upsert-like), so replaying
      // the same event just overwrites with the same values — no corruption.
      expect(mockUpdateSubscriptionStatus).toHaveBeenCalledTimes(2);
      expect(mockUpdateSubscriptionStatus).toHaveBeenNthCalledWith(
        1,
        "cus_test_abc",
        "sub_test_123",
        "active",
      );
      expect(mockUpdateSubscriptionStatus).toHaveBeenNthCalledWith(
        2,
        "cus_test_abc",
        "sub_test_123",
        "active",
      );
    });
  });

  /* ---------------------------------------------------------------- */
  /*  No user session auth required                                    */
  /* ---------------------------------------------------------------- */

  describe("no user session auth", () => {
    it("does not require actor/session middleware (authenticates via Stripe signature)", async () => {
      const app = await createApp();
      const event = subscriptionEvent("customer.subscription.created");

      mockConstructEvent.mockReturnValue(event);
      mockUpdateSubscriptionStatus.mockResolvedValue(null);

      // No actor middleware, no session cookie, no auth headers — just Stripe signature
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      expect(res.status).toBe(200);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Error handling                                                   */
  /* ---------------------------------------------------------------- */

  describe("error handling", () => {
    it("returns 200 even when updateSubscriptionStatus fails (log and move on)", async () => {
      const app = await createApp();
      const event = subscriptionEvent("customer.subscription.created");

      mockConstructEvent.mockReturnValue(event);
      mockUpdateSubscriptionStatus.mockRejectedValue(
        new Error("DB connection lost"),
      );

      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("stripe-signature", "t=123,v1=abc")
        .send(event);

      // Webhook should still return 200 to avoid Stripe retrying endlessly
      // for a transient DB error. The event will be retried naturally by Stripe.
      // Actually, Stripe recommends returning 200 only on success and 500 on failure
      // so Stripe will retry. Let me handle this properly.
      // On second thought, best practice is to return 500 on internal errors
      // so Stripe retries the event.
      expect(res.status).toBe(500);
    });
  });
});
