import { describe, expect, it } from "vitest";
import {
  applyMailLabelMutation,
  buildAgentMailSubject,
  isOutboundMailMessage,
  isUnreadMailMessage,
  splitAgentMailList,
} from "./agentmail";

describe("agentmail ui helpers", () => {
  it("splits comma-delimited lists into trimmed values", () => {
    expect(splitAgentMailList(" alpha@example.com, beta@example.com , gamma@example.com "))
      .toEqual(["alpha@example.com", "beta@example.com", "gamma@example.com"]);
  });

  it("adds a reply/forward subject prefix only when needed", () => {
    expect(buildAgentMailSubject("Re", "Founder update")).toBe("Re: Founder update");
    expect(buildAgentMailSubject("Re", "Re: Founder update")).toBe("Re: Founder update");
    expect(buildAgentMailSubject("Fwd", "")).toBe("Fwd: ");
  });

  it("detects outbound messages from labels, direction, or sender address", () => {
    expect(
      isOutboundMailMessage(
        {
          labels: ["sent"],
          from: "founder@agentmail.to",
        },
        "founder@agentmail.to",
      ),
    ).toBe(true);

    expect(
      isOutboundMailMessage(
        {
          direction: "outbound",
          from: "someone@example.com",
        },
        "founder@agentmail.to",
      ),
    ).toBe(true);

    expect(
      isOutboundMailMessage(
        {
          from: "founder@agentmail.to",
          labels: [],
        },
        "founder@agentmail.to",
      ),
    ).toBe(true);

    expect(
      isOutboundMailMessage(
        {
          from: "customer@example.com",
          labels: ["inbox"],
        },
        "founder@agentmail.to",
      ),
    ).toBe(false);
  });

  it("treats read as authoritative when both read and unread labels are present", () => {
    expect(
      isUnreadMailMessage({
        labels: ["unread", "read"],
      }),
    ).toBe(false);

    expect(
      isUnreadMailMessage({
        labels: ["unread"],
      }),
    ).toBe(true);
  });

  it("applies read label mutations without duplicating labels", () => {
    expect(
      applyMailLabelMutation(
        {
          message_id: "msg_123",
          labels: ["unread", "important"],
        },
        {
          addLabels: ["read"],
          removeLabels: ["unread"],
        },
      ).labels,
    ).toEqual(["important", "read"]);
  });
});
