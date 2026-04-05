import { describe, expect, it } from "vitest";
import {
  filterVisibleAgentAdapterTypes,
  getDefaultVisibleAgentAdapterType,
  normalizeAgentAdapterVisibilityEmail,
  shouldRestrictAgentAdapterCatalog,
} from "./agent-adapter-visibility";

describe("agent adapter visibility", () => {
  it("normalizes adapter visibility emails", () => {
    expect(normalizeAgentAdapterVisibilityEmail(" TomCharlesOsman@gmail.com ")).toBe("tomcharlesosman@gmail.com");
    expect(normalizeAgentAdapterVisibilityEmail("")).toBeNull();
    expect(normalizeAgentAdapterVisibilityEmail(null)).toBeNull();
  });

  it("keeps the expanded adapter catalog for the allowlisted owner", () => {
    expect(shouldRestrictAgentAdapterCatalog("tomcharlesosman@gmail.com")).toBe(false);
    expect(
      filterVisibleAgentAdapterTypes(
        ["claude_local", "claude_platform", "codex_local"],
        "tomcharlesosman@gmail.com",
      ),
    ).toEqual(["claude_local", "claude_platform", "codex_local"]);
  });

  it("keeps the expanded adapter catalog for local board development", () => {
    expect(shouldRestrictAgentAdapterCatalog("local@paperclip.local")).toBe(false);
  });

  it("restricts non-allowlisted users to the hosted and remote adapters", () => {
    expect(shouldRestrictAgentAdapterCatalog("someone@example.com")).toBe(true);
    expect(
      filterVisibleAgentAdapterTypes(
        ["claude_local", "claude_platform", "codex_local", "openclaw_gateway", "http"],
        "someone@example.com",
      ),
    ).toEqual(["claude_platform", "openclaw_gateway", "http"]);
    expect(getDefaultVisibleAgentAdapterType("someone@example.com")).toBe("claude_platform");
  });

  it("can restrict anonymous invite flows while leaving authenticated screens permissive during loading", () => {
    expect(
      filterVisibleAgentAdapterTypes(
        ["claude_local", "claude_platform", "codex_local", "openclaw_gateway", "http"],
        null,
      ),
    ).toEqual(["claude_local", "claude_platform", "codex_local", "openclaw_gateway", "http"]);
    expect(
      filterVisibleAgentAdapterTypes(
        ["claude_local", "claude_platform", "codex_local", "openclaw_gateway", "http"],
        null,
        { restrictWhenEmailMissing: true },
      ),
    ).toEqual(["claude_platform", "openclaw_gateway", "http"]);
  });
});
