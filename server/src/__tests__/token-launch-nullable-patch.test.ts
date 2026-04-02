import { describe, expect, it, vi, beforeEach } from "vitest";
import { tokenLaunchService } from "../services/token-launch.ts";
import {
  companyTokenLaunches,
  companyTokenLaunchRequests,
  userWalletLinks,
} from "@paperclipai/db";

/**
 * Unit tests for nullable patch semantics in updateLaunchDraft.
 *
 * The key behavior:
 * - `undefined` (field omitted from PATCH) → preserve existing DB value
 * - explicit `null` (user cleared field) → persist null in DB
 *
 * The first section ("resolvePatch behavior") tests the helper logic
 * in isolation as a regression proof. The second section
 * ("service-path: updateLaunchDraft") exercises the real
 * tokenLaunchService.updateLaunchDraft method with a mock DB and asserts
 * on the values passed to db.update().set().
 */

/* ------------------------------------------------------------------ */
/* Pure-logic tests (regression proof for resolvePatch helper)        */
/* ------------------------------------------------------------------ */

describe("nullable patch semantics", () => {
  describe("resolvePatch behavior", () => {
    // Replicate the logic from the service to verify correctness
    function resolvePatch<T>(patchValue: T | undefined, existing: T): T {
      return patchValue !== undefined ? patchValue : existing;
    }

    it("returns patch value when explicitly set to null (clearing a field)", () => {
      expect(resolvePatch(null, "existing-value")).toBe(null);
    });

    it("returns existing value when patch value is undefined (field omitted)", () => {
      expect(resolvePatch(undefined, "existing-value")).toBe("existing-value");
    });

    it("returns new value when patch has a string", () => {
      expect(resolvePatch("new-value", "existing-value")).toBe("new-value");
    });

    it("returns empty string when patch is empty string", () => {
      expect(resolvePatch("", "existing-value")).toBe("");
    });

    it("preserves null existing value when patch is undefined", () => {
      expect(resolvePatch(undefined, null)).toBe(null);
    });

    it("replaces null existing value with new string", () => {
      expect(resolvePatch("new-value", null)).toBe("new-value");
    });
  });

  describe("old ?? behavior (regression proof)", () => {
    // Demonstrate the bug that existed with ?? operator
    function oldResolvePatch<T>(patchValue: T | null | undefined, existing: T): T | null {
      return (patchValue ?? existing) as T | null;
    }

    it("BUG: ?? would preserve existing value when patch is null", () => {
      // With ??, null falls through to existing — this is the bug we fixed
      expect(oldResolvePatch(null, "existing-value")).toBe("existing-value");
    });

    it("?? correctly preserves existing when patch is undefined", () => {
      expect(oldResolvePatch(undefined, "existing-value")).toBe("existing-value");
    });
  });

  describe("simulation fingerprint invalidation on field clearing", () => {
    it("clearing a payload-affecting field changes the fingerprint", () => {
      // The merged draft uses spread which correctly reflects null values:
      // { ...existingDraft, ...patch } where patch has tokenName: null
      const existingDraft = {
        tokenName: "TestToken",
        tokenSymbol: "TT",
        tokenDescription: "desc",
        imageUrl: null,
        tweetUrl: null,
        tokenWebsiteUrl: null,
        companyWebsiteUrl: null,
        selectedFeeWalletAddress: "0xabc",
        stage: null,
        businessSummary: null,
        tractionSummary: null,
        launchRationale: null,
        socialLinks: { x: null, farcaster: null, telegram: null, discord: null },
      };

      // Simulate a patch that clears tokenName
      const patch = { tokenName: null };
      const mergedDraft = { ...existingDraft, ...patch };

      // The merged draft should have tokenName as null
      expect(mergedDraft.tokenName).toBe(null);

      // And the DB update should also write null (not preserve "TestToken")
      // This is verified by resolvePatch(null, "TestToken") === null
      function resolvePatch<T>(patchValue: T | undefined, existing: T): T {
        return patchValue !== undefined ? patchValue : existing;
      }
      expect(resolvePatch(patch.tokenName, "TestToken")).toBe(null);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Service-path tests: call the real tokenLaunchService.updateLaunchDraft */
/* with a mock Drizzle DB and assert on the values passed to .set()   */
/* ------------------------------------------------------------------ */

describe("service-path: updateLaunchDraft", () => {
  const COMPANY_ID = "b0000000-0000-4000-8000-000000000001";
  const LAUNCH_ID = "a0000000-0000-4000-8000-000000000001";
  const USER_ID = "user-1";

  /** Build a mock launch row with proper UUIDs for Zod validation. */
  function createServiceRow(overrides: Record<string, unknown> = {}) {
    return {
      id: LAUNCH_ID,
      companyId: COMPANY_ID,
      stage: null as string | null,
      companyWebsiteUrl: null as string | null,
      businessSummary: null as string | null,
      tractionSummary: null as string | null,
      launchRationale: null as string | null,
      socialLinks: { x: null, farcaster: null, telegram: null, discord: null },
      tokenName: "TestToken" as string | null,
      tokenSymbol: "TT" as string | null,
      tokenDescription: null as string | null,
      imageUrl: null as string | null,
      tweetUrl: null as string | null,
      tokenWebsiteUrl: null as string | null,
      selectedFeeWalletAddress: "0xabc123" as string | null,
      latestSimulationFingerprint: null as string | null,
      latestSimulation: null as Record<string, unknown> | null,
      latestSimulationAt: null as Date | null,
      deployedTokenAddress: null as string | null,
      deployedPoolId: null as string | null,
      deployedTxHash: null as string | null,
      deployedActivityId: null as string | null,
      deployedChain: null as string | null,
      deployedFeeDistribution: null as Record<string, unknown> | null,
      deployedAt: null as Date | null,
      deploymentUnknownAt: null as Date | null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      ...overrides,
    };
  }

  /**
   * Build a mock Drizzle DB that supports the full query chains used by
   * updateLaunchDraft and the getLaunch call at the end.
   *
   * Differentiates tables via Drizzle table references (identity check)
   * so parallel calls (Promise.all) in the service resolve correctly.
   *
   * The mock keeps a mutable row reference that is updated when .set()
   * is called, so the subsequent getLaunch re-query returns the updated
   * state (important for Zod validation of latestSimulation).
   */
  function createServiceDb(initialRow: ReturnType<typeof createServiceRow>) {
    const capturedSetArgs: Record<string, unknown>[] = [];
    let currentRow = { ...initialRow };

    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation((table: unknown) => {
          if (table === companyTokenLaunches) {
            // ensureLaunchRow: select().from(companyTokenLaunches).where(...).then(...)
            return {
              where: vi.fn().mockImplementation(() => Promise.resolve([currentRow])),
            };
          }
          if (table === userWalletLinks) {
            // getWalletOptions: select({...}).from(userWalletLinks).where(...)
            return { where: vi.fn().mockResolvedValue([]) };
          }
          if (table === companyTokenLaunchRequests) {
            // listRequestRows: select({...}).from(requests).innerJoin(...).where(...).orderBy(...)
            return {
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockResolvedValue([]),
                }),
              }),
            };
          }
          return { where: vi.fn().mockResolvedValue([]) };
        }),
      })),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
          capturedSetArgs.push({ ...values });
          currentRow = { ...currentRow, ...values };
          return {
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockImplementation(() =>
                Promise.resolve([currentRow]),
              ),
            }),
          };
        }),
      })),
    };

    return { db, capturedSetArgs };
  }

  it("explicit null clears tokenName through the actual service", async () => {
    const row = createServiceRow({ tokenName: "TestToken" });
    const { db, capturedSetArgs } = createServiceDb(row);
    const svc = tokenLaunchService(db as any);

    await svc.updateLaunchDraft(COMPANY_ID, USER_ID, { tokenName: null });

    expect(capturedSetArgs).toHaveLength(1);
    expect(capturedSetArgs[0].tokenName).toBe(null);
  });

  it("omitted field preserves existing tokenName through the actual service", async () => {
    const row = createServiceRow({ tokenName: "TestToken" });
    const { db, capturedSetArgs } = createServiceDb(row);
    const svc = tokenLaunchService(db as any);

    await svc.updateLaunchDraft(COMPANY_ID, USER_ID, {
      businessSummary: "updated summary",
    });

    expect(capturedSetArgs).toHaveLength(1);
    expect(capturedSetArgs[0].tokenName).toBe("TestToken");
  });

  it("clearing a payload-affecting field invalidates the simulation fingerprint", async () => {
    const row = createServiceRow({
      tokenName: "TestToken",
      selectedFeeWalletAddress: "0xabc123",
      latestSimulationFingerprint: "fp-abc",
      latestSimulation: { some: "data" },
      latestSimulationAt: new Date("2024-01-02"),
    });
    const { db, capturedSetArgs } = createServiceDb(row);
    const svc = tokenLaunchService(db as any);

    // Clearing tokenName makes buildBankrPayload throw → nextFingerprint = null
    // shouldClearSimulation = "fp-abc" !== null && "fp-abc" !== null → true
    await svc.updateLaunchDraft(COMPANY_ID, USER_ID, { tokenName: null });

    expect(capturedSetArgs).toHaveLength(1);
    expect(capturedSetArgs[0].latestSimulationFingerprint).toBe(null);
    expect(capturedSetArgs[0].latestSimulation).toBe(null);
    expect(capturedSetArgs[0].latestSimulationAt).toBe(null);
  });

  it("no fingerprint invalidation when there is no existing simulation", async () => {
    const row = createServiceRow({
      tokenName: "TestToken",
      latestSimulationFingerprint: null,
      latestSimulation: null,
      latestSimulationAt: null,
    });
    const { db, capturedSetArgs } = createServiceDb(row);
    const svc = tokenLaunchService(db as any);

    // Clearing tokenName makes nextFingerprint = null
    // shouldClearSimulation = null !== null → false, so fingerprint stays null
    await svc.updateLaunchDraft(COMPANY_ID, USER_ID, { tokenName: null });

    expect(capturedSetArgs).toHaveLength(1);
    expect(capturedSetArgs[0].latestSimulationFingerprint).toBe(null);
    expect(capturedSetArgs[0].latestSimulation).toBe(null);
    expect(capturedSetArgs[0].latestSimulationAt).toBe(null);
  });

  it("mixed patch: null clears, new value updates, omitted preserves", async () => {
    const row = createServiceRow({
      tokenName: "TestToken",
      tokenSymbol: "TT",
      tokenDescription: "Original desc",
    });
    const { db, capturedSetArgs } = createServiceDb(row);
    const svc = tokenLaunchService(db as any);

    await svc.updateLaunchDraft(COMPANY_ID, USER_ID, {
      tokenName: null,      // explicit null → should clear
      tokenSymbol: "NEW",   // new value → should update
      // tokenDescription omitted → should preserve "Original desc"
    });

    expect(capturedSetArgs).toHaveLength(1);
    expect(capturedSetArgs[0].tokenName).toBe(null);
    expect(capturedSetArgs[0].tokenSymbol).toBe("NEW");
    expect(capturedSetArgs[0].tokenDescription).toBe("Original desc");
  });

  it("clearing selectedFeeWalletAddress invalidates fingerprint when simulation exists", async () => {
    const row = createServiceRow({
      tokenName: "TestToken",
      selectedFeeWalletAddress: "0xabc123",
      latestSimulationFingerprint: "fp-wallet",
      latestSimulation: { some: "data" },
      latestSimulationAt: new Date("2024-01-02"),
    });
    const { db, capturedSetArgs } = createServiceDb(row);
    const svc = tokenLaunchService(db as any);

    // Clearing feeWallet makes buildBankrPayload throw → nextFingerprint = null
    await svc.updateLaunchDraft(COMPANY_ID, USER_ID, {
      selectedFeeWalletAddress: null,
    });

    expect(capturedSetArgs).toHaveLength(1);
    expect(capturedSetArgs[0].selectedFeeWalletAddress).toBe(null);
    expect(capturedSetArgs[0].latestSimulationFingerprint).toBe(null);
    expect(capturedSetArgs[0].latestSimulation).toBe(null);
    expect(capturedSetArgs[0].latestSimulationAt).toBe(null);
  });
});
