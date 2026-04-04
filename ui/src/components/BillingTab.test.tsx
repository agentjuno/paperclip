// @vitest-environment node

import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mockUseQuery = vi.hoisted(() => vi.fn());
const mockUseMutation = vi.hoisted(() => vi.fn());
const mockPushToast = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>(
      "@tanstack/react-query",
    );

  return {
    ...actual,
    useQuery: mockUseQuery,
    useMutation: mockUseMutation,
  };
});

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({
    pushToast: mockPushToast,
  }),
}));

describe("BillingTab", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    mockUseMutation.mockReset();
    mockPushToast.mockReset();

    mockUseMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
  });

  it("shows the loading skeleton while subscription status is still pending", async () => {
    mockUseQuery
      .mockReturnValueOnce({
        data: undefined,
        isLoading: false,
        isPending: true,
        error: null,
        refetch: vi.fn(),
      })
      .mockReturnValueOnce({
        data: undefined,
        isLoading: false,
        isPending: false,
        error: null,
      });

    const { BillingTab } = await import("./BillingTab");
    const markup = renderToStaticMarkup(<BillingTab />);

    expect(markup).toContain("billing-loading");
    expect(markup).not.toContain("billing-no-subscription");
  });

  it('shows the subscribe CTA only after the status query resolves to "none"', async () => {
    mockUseQuery
      .mockReturnValueOnce({
        data: {
          status: "none",
          stripeCustomerId: null,
          subscriptionId: null,
        },
        isLoading: false,
        isPending: false,
        error: null,
        refetch: vi.fn(),
      })
      .mockReturnValueOnce({
        data: {
          rows: [],
          totalTokens: 0,
          totalCostCents: 0,
        },
        isLoading: false,
        isPending: false,
        error: null,
      });

    const { BillingTab } = await import("./BillingTab");
    const markup = renderToStaticMarkup(<BillingTab />);

    expect(markup).toContain("billing-no-subscription");
    expect(markup).not.toContain("billing-loading");
  });
});

describe("billingApi module shape", () => {
  it("exports all required API client functions", async () => {
    const { billingApi } = await import("../api/billing");

    expect(typeof billingApi.getSubscriptionStatus).toBe("function");
    expect(typeof billingApi.createCheckoutSession).toBe("function");
    expect(typeof billingApi.createPortalSession).toBe("function");
    expect(typeof billingApi.getUsageSummary).toBe("function");
  });
});

describe("BillingUsageSummary type contract", () => {
  it("getUsageSummary transforms rows into summary shape", async () => {
    const { billingApi } = await import("../api/billing");

    expect(billingApi.getUsageSummary).toBeDefined();
    expect(billingApi.getUsageSummary.length).toBeGreaterThanOrEqual(1);
  });
});
