import { describe, expect, it } from "vitest";
import {
  applyCompanyPrefix,
  extractCompanyPrefixFromPath,
  isBoardPathWithoutPrefix,
} from "./company-routes";

describe("company token-launch routing", () => {
  it("treats /token-launch as a board route that can be company-prefixed", () => {
    expect(isBoardPathWithoutPrefix("/token-launch")).toBe(true);
    expect(applyCompanyPrefix("/token-launch", "JUNO")).toBe("/JUNO/token-launch");
    expect(extractCompanyPrefixFromPath("/JUNO/token-launch")).toBe("JUNO");
  });
});
