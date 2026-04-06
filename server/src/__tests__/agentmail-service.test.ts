import { describe, expect, it } from "vitest";
import {
  buildPodClientId,
  buildPrimaryInboxClientId,
  buildWebhookClientId,
  normalizeAgentMailMessageUpdateBody,
  normalizeAgentMailClientId,
} from "../services/agentmail.js";

describe("agentmail client id helpers", () => {
  it("builds deterministic client ids with AgentMail-safe characters", () => {
    expect(buildPodClientId("company-1")).toBe("company.company-1");
    expect(buildPrimaryInboxClientId("company-1")).toBe("company.company-1.primary");
    expect(buildWebhookClientId("company-1")).toBe("company.company-1.webhook");
  });

  it("sanitizes invalid characters within deterministic segments", () => {
    expect(buildPodClientId("ACME / Spain")).toBe("company.ACME-Spain");
  });

  it("normalizes legacy colon-delimited ids on retry", () => {
    expect(normalizeAgentMailClientId("company:company-1:primary", "fallback")).toBe("company.company-1.primary");
  });

  it("falls back when normalization cannot produce a usable id", () => {
    expect(normalizeAgentMailClientId(":::", "company.company-1")).toBe("company.company-1");
  });

  it("translates camelCase message update fields into AgentMail's snake_case API shape", () => {
    expect(
      normalizeAgentMailMessageUpdateBody({
        addLabels: ["read"],
        removeLabels: ["unread"],
        labels: ["inbox"],
      }),
    ).toEqual({
      add_labels: ["read"],
      remove_labels: ["unread"],
      labels: ["inbox"],
    });
  });
});
