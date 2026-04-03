import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mock: stripe SDK (meter events use a separate Stripe instance      */
/*  initialized with STRIPE_RESTRICTED_KEY)                            */
/* ------------------------------------------------------------------ */

const mockMeterEventsCreate = vi.fn();

vi.mock("stripe", () => {
  const StripeClass = vi.fn().mockImplementation(() => ({
    billing: {
      meterEvents: {
        create: mockMeterEventsCreate,
      },
    },
  }));
  return { default: StripeClass };
});

/* ------------------------------------------------------------------ */
/*  Mock: stripe-billing-config                                        */
/* ------------------------------------------------------------------ */

vi.mock("../services/stripe-billing-config.js", () => ({
  getStripeRestrictedKey: () => "rk_test_mock_restricted_key",
  getStripeSecretKey: () => "sk_test_mock_key",
  isStripeBillingConfigured: () => true,
}));

/* ------------------------------------------------------------------ */
/*  Import the service under test (after mocks are set up)             */
/* ------------------------------------------------------------------ */

const { meterEventService } = await import("../services/meter-events.js");

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("meterEventService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("reportTokenUsage", () => {
    it("sends separate meter events for input and output tokens", async () => {
      mockMeterEventsCreate.mockResolvedValue({ identifier: "test" });

      const service = meterEventService();
      await service.reportTokenUsage({
        heartbeatRunId: "run-123",
        stripeCustomerId: "cus_test_abc",
        model: "gpt-4o",
        inputTokens: 500,
        outputTokens: 200,
      });

      // Should be called twice: once for input, once for output
      expect(mockMeterEventsCreate).toHaveBeenCalledTimes(2);

      // Input tokens event
      expect(mockMeterEventsCreate).toHaveBeenCalledWith({
        event_name: "token-billing-tokens",
        payload: {
          stripe_customer_id: "cus_test_abc",
          model: "gpt-4o",
          token_type: "input",
          value: "500",
        },
        identifier: "run-123-input",
        timestamp: expect.any(Number),
      });

      // Output tokens event
      expect(mockMeterEventsCreate).toHaveBeenCalledWith({
        event_name: "token-billing-tokens",
        payload: {
          stripe_customer_id: "cus_test_abc",
          model: "gpt-4o",
          token_type: "output",
          value: "200",
        },
        identifier: "run-123-output",
        timestamp: expect.any(Number),
      });
    });

    it("uses heartbeatRunId+tokenType as idempotency key", async () => {
      mockMeterEventsCreate.mockResolvedValue({ identifier: "test" });

      const service = meterEventService();
      await service.reportTokenUsage({
        heartbeatRunId: "run-456",
        stripeCustomerId: "cus_test_xyz",
        model: "claude-3-5-sonnet",
        inputTokens: 100,
        outputTokens: 50,
      });

      const calls = mockMeterEventsCreate.mock.calls;
      const identifiers = calls.map((c: any[]) => c[0].identifier);
      expect(identifiers).toContain("run-456-input");
      expect(identifiers).toContain("run-456-output");
    });

    it("uses event_name 'token-billing-tokens'", async () => {
      mockMeterEventsCreate.mockResolvedValue({ identifier: "test" });

      const service = meterEventService();
      await service.reportTokenUsage({
        heartbeatRunId: "run-789",
        stripeCustomerId: "cus_test_def",
        model: "gpt-4o-mini",
        inputTokens: 300,
        outputTokens: 100,
      });

      for (const call of mockMeterEventsCreate.mock.calls) {
        expect(call[0].event_name).toBe("token-billing-tokens");
      }
    });

    it("skips input event when inputTokens is zero", async () => {
      mockMeterEventsCreate.mockResolvedValue({ identifier: "test" });

      const service = meterEventService();
      await service.reportTokenUsage({
        heartbeatRunId: "run-zero-in",
        stripeCustomerId: "cus_test_ghi",
        model: "gpt-4o",
        inputTokens: 0,
        outputTokens: 150,
      });

      // Only output token event should be sent
      expect(mockMeterEventsCreate).toHaveBeenCalledTimes(1);
      expect(mockMeterEventsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            token_type: "output",
            value: "150",
          }),
        }),
      );
    });

    it("skips output event when outputTokens is zero", async () => {
      mockMeterEventsCreate.mockResolvedValue({ identifier: "test" });

      const service = meterEventService();
      await service.reportTokenUsage({
        heartbeatRunId: "run-zero-out",
        stripeCustomerId: "cus_test_jkl",
        model: "gpt-4o",
        inputTokens: 250,
        outputTokens: 0,
      });

      // Only input token event should be sent
      expect(mockMeterEventsCreate).toHaveBeenCalledTimes(1);
      expect(mockMeterEventsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            token_type: "input",
            value: "250",
          }),
        }),
      );
    });

    it("sends no events when both inputTokens and outputTokens are zero", async () => {
      const service = meterEventService();
      await service.reportTokenUsage({
        heartbeatRunId: "run-all-zero",
        stripeCustomerId: "cus_test_mno",
        model: "gpt-4o",
        inputTokens: 0,
        outputTokens: 0,
      });

      expect(mockMeterEventsCreate).not.toHaveBeenCalled();
    });

    it("includes model in meter event payload", async () => {
      mockMeterEventsCreate.mockResolvedValue({ identifier: "test" });

      const service = meterEventService();
      await service.reportTokenUsage({
        heartbeatRunId: "run-model",
        stripeCustomerId: "cus_test_pqr",
        model: "claude-3-5-sonnet-20250101",
        inputTokens: 100,
        outputTokens: 50,
      });

      for (const call of mockMeterEventsCreate.mock.calls) {
        expect(call[0].payload.model).toBe("claude-3-5-sonnet-20250101");
      }
    });

    it("does not throw when Stripe API fails (fire-and-forget)", async () => {
      mockMeterEventsCreate.mockRejectedValue(
        new Error("Stripe API error: invalid key"),
      );

      const service = meterEventService();

      // Should not throw
      await expect(
        service.reportTokenUsage({
          heartbeatRunId: "run-fail",
          stripeCustomerId: "cus_test_stu",
          model: "gpt-4o",
          inputTokens: 100,
          outputTokens: 50,
        }),
      ).resolves.toBeUndefined();
    });

    it("logs errors with context when meter event fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockMeterEventsCreate.mockRejectedValue(
        new Error("Stripe rate limit exceeded"),
      );

      const service = meterEventService();
      await service.reportTokenUsage({
        heartbeatRunId: "run-log-err",
        stripeCustomerId: "cus_test_vwx",
        model: "gpt-4o",
        inputTokens: 100,
        outputTokens: 50,
      });

      // Should log errors with heartbeatRunId context
      expect(consoleSpy).toHaveBeenCalled();
      const logMessages = consoleSpy.mock.calls.map((c) => c.join(" "));
      const hasRunIdContext = logMessages.some((msg) =>
        msg.includes("run-log-err"),
      );
      expect(hasRunIdContext).toBe(true);

      consoleSpy.mockRestore();
    });

    it("handles optional cachedInputTokens parameter", async () => {
      mockMeterEventsCreate.mockResolvedValue({ identifier: "test" });

      const service = meterEventService();
      await service.reportTokenUsage({
        heartbeatRunId: "run-cached",
        stripeCustomerId: "cus_test_cached",
        model: "gpt-4o",
        inputTokens: 300,
        outputTokens: 100,
        cachedInputTokens: 200,
      });

      // Should still send 2 events (input + output), cachedInputTokens is metadata only
      expect(mockMeterEventsCreate).toHaveBeenCalledTimes(2);
    });

    it("passes stripe_customer_id in payload correctly", async () => {
      mockMeterEventsCreate.mockResolvedValue({ identifier: "test" });

      const service = meterEventService();
      await service.reportTokenUsage({
        heartbeatRunId: "run-cust",
        stripeCustomerId: "cus_test_specific_customer",
        model: "gpt-4o",
        inputTokens: 100,
        outputTokens: 50,
      });

      for (const call of mockMeterEventsCreate.mock.calls) {
        expect(call[0].payload.stripe_customer_id).toBe("cus_test_specific_customer");
      }
    });
  });
});
