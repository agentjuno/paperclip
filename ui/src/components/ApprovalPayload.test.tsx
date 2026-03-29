// @vitest-environment node

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalPayloadRenderer, approvalLabel } from "./ApprovalPayload";

describe("ApprovalPayload token launch rendering", () => {
  it("builds a readable label from token launch payloads", () => {
    expect(
      approvalLabel("token_launch", {
        tokenName: "Juno Network",
        tokenSymbol: "JUNO",
      }),
    ).toBe("Token Launch: Juno Network ($JUNO)");
  });

  it("renders reviewer-facing token launch details", () => {
    const html = renderToStaticMarkup(
      <ApprovalPayloadRenderer
        type="token_launch"
        payload={{
          tokenName: "Juno Network",
          tokenSymbol: "JUNO",
          feeWalletAddress: "0x1234567890abcdef1234567890abcdef12345678",
          tokenWebsiteUrl: "https://juno.example",
          launchRationale: "Strong real business traction with aligned community demand.",
          simulation: {
            tokenAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            poolId: "pool-123",
            chain: "base",
            feeDistribution: {
              creator: {
                address: "0x1234567890abcdef1234567890abcdef12345678",
                bps: 100,
              },
            },
          },
        }}
      />,
    );

    expect(html).toContain("Juno Network");
    expect(html).toContain("0x1234567890abcdef1234567890abcdef12345678");
    expect(html).toContain("https://juno.example");
    expect(html).toContain("Strong real business traction");
    expect(html).toContain("Simulated token 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(html).toContain("creator: 1%");
  });
});
