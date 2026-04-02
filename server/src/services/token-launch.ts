import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  approvals,
  companyTokenLaunchRequests,
  companyTokenLaunches,
  userWalletLinks,
} from "@paperclipai/db";
import type {
  BankrPartnerDeployRequest,
  BankrPartnerDeployResult,
  CompanyTokenLaunch,
  CompanyTokenLaunchDraft,
  CompanyTokenLaunchRequest,
  CompanyTokenLaunchSimulation,
  CompanyTokenLaunchSocialLinks,
  TokenLaunchWalletOption,
} from "@paperclipai/shared";
import {
  bankrPartnerDeployRequestSchema,
  bankrPartnerDeployResultSchema,
  companyTokenLaunchRequestSchema,
  companyTokenLaunchSchema,
  companyTokenLaunchSimulationSchema,
  tokenLaunchWalletOptionSchema,
  type CompanyTokenLaunchDraftUpdate,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import {
  BankrApiError,
  BankrRequestUncertainError,
  liveDeployTokenWithBankr,
  simulateTokenLaunchWithBankr,
} from "./token-launch-bankr.js";

const CLAIM_FEES_DOCS_URL = "https://docs.bankr.bot/token-launching/claiming-fees/";
const SUPPORTED_WALLET_CHAINS = new Set(["", "ethereum", "evm", "base"]);

type LaunchRow = typeof companyTokenLaunches.$inferSelect;
type LaunchRequestRow = typeof companyTokenLaunchRequests.$inferSelect;

function getBankrAppBaseUrl() {
  return process.env.BANKR_APP_BASE_URL?.trim() || "https://bankr.bot";
}

function normalizeWalletAddress(address: string) {
  return address.trim().toLowerCase();
}

function normalizeSocialLinks(
  value: Record<string, string | null> | null | undefined,
): CompanyTokenLaunchSocialLinks {
  return {
    x: typeof value?.x === "string" ? value.x : null,
    farcaster: typeof value?.farcaster === "string" ? value.farcaster : null,
    telegram: typeof value?.telegram === "string" ? value.telegram : null,
    discord: typeof value?.discord === "string" ? value.discord : null,
  };
}

function supportsLaunchWallet(chainType: string | null | undefined) {
  return SUPPORTED_WALLET_CHAINS.has((chainType ?? "").trim().toLowerCase());
}

function walletSort(a: TokenLaunchWalletOption, b: TokenLaunchWalletOption) {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  return normalizeWalletAddress(a.address).localeCompare(normalizeWalletAddress(b.address));
}

function walletMatches(address: string | null | undefined, wallet: TokenLaunchWalletOption) {
  if (!address) return false;
  return normalizeWalletAddress(address) === normalizeWalletAddress(wallet.address);
}

function resolveSelectedWalletAddress(
  row: LaunchRow,
  walletOptions: TokenLaunchWalletOption[],
) {
  if (row.selectedFeeWalletAddress) {
    const matchesCurrentUser = walletOptions.some((wallet) => walletMatches(row.selectedFeeWalletAddress, wallet));
    if (matchesCurrentUser || walletOptions.length === 0) {
      return row.selectedFeeWalletAddress;
    }
  }
  return walletOptions.find((wallet) => wallet.isPrimary)?.address ?? walletOptions[0]?.address ?? null;
}

function buildDraft(
  row: LaunchRow,
  walletOptions: TokenLaunchWalletOption[],
): CompanyTokenLaunchDraft {
  return {
    stage: row.stage ?? null,
    companyWebsiteUrl: row.companyWebsiteUrl ?? null,
    businessSummary: row.businessSummary ?? null,
    tractionSummary: row.tractionSummary ?? null,
    launchRationale: row.launchRationale ?? null,
    socialLinks: normalizeSocialLinks(row.socialLinks),
    tokenName: row.tokenName ?? null,
    tokenSymbol: row.tokenSymbol ?? null,
    tokenDescription: row.tokenDescription ?? null,
    imageUrl: row.imageUrl ?? null,
    tweetUrl: row.tweetUrl ?? null,
    tokenWebsiteUrl: row.tokenWebsiteUrl ?? null,
    selectedFeeWalletAddress: resolveSelectedWalletAddress(row, walletOptions),
  };
}

function buildClaimFeesUrl(tokenAddress: string | null) {
  if (!tokenAddress) return null;
  return `${getBankrAppBaseUrl().replace(/\/+$/, "")}/launches/${tokenAddress}`;
}

function buildBankrPayload(draft: CompanyTokenLaunchDraft): BankrPartnerDeployRequest {
  const tokenName = draft.tokenName?.trim();
  if (!tokenName) {
    throw unprocessable("Token name is required before simulating or submitting.");
  }
  const feeWallet = draft.selectedFeeWalletAddress?.trim();
  if (!feeWallet) {
    throw unprocessable("Select a synced Base wallet before simulating or submitting.");
  }

  return bankrPartnerDeployRequestSchema.parse({
    tokenName,
    tokenSymbol: draft.tokenSymbol?.trim() || undefined,
    description: draft.tokenDescription?.trim() || undefined,
    image: draft.imageUrl?.trim() || undefined,
    tweetUrl: draft.tweetUrl?.trim() || undefined,
    websiteUrl: draft.tokenWebsiteUrl?.trim() || draft.companyWebsiteUrl?.trim() || undefined,
    feeRecipient: {
      type: "wallet",
      value: feeWallet,
    },
  });
}

function buildSimulationFingerprint(payload: BankrPartnerDeployRequest) {
  const stable = {
    tokenName: payload.tokenName,
    tokenSymbol: payload.tokenSymbol ?? null,
    description: payload.description ?? null,
    image: payload.image ?? null,
    tweetUrl: payload.tweetUrl ?? null,
    websiteUrl: payload.websiteUrl ?? null,
    feeRecipient: payload.feeRecipient,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function parseSimulation(raw: Record<string, unknown> | null | undefined) {
  if (!raw) return null;
  return companyTokenLaunchSimulationSchema.parse(raw);
}

function parseRequest(
  row: LaunchRequestRow,
  approvalStatus: string,
  decisionNote: string | null,
): CompanyTokenLaunchRequest {
  return companyTokenLaunchRequestSchema.parse({
    ...row,
    bankrPayload: bankrPartnerDeployRequestSchema.parse(row.bankrPayload),
    simulationResult: bankrPartnerDeployResultSchema.parse(row.simulationResult),
    feeDistribution: row.feeDistribution ?? null,
    approvalStatus,
    decisionNote,
  });
}

/**
 * Resolve a patch field for nullable draft columns.
 * - `undefined` → field was not in the PATCH body, keep existing DB value
 * - any other value (including `null`) → use the patch value (clearing or updating)
 */
function resolvePatch<T>(patchValue: T | undefined, existing: T): T {
  return patchValue !== undefined ? patchValue : existing;
}

function isCompanyLocked(row: LaunchRow) {
  return Boolean(row.deployedTokenAddress || row.deploymentUnknownAt);
}

function approvalBlocksNewSubmission(
  request: CompanyTokenLaunchRequest,
) {
  if (request.approvalStatus === "pending") return true;
  if (request.approvalStatus === "approved") {
    return request.deployStatus === "not_started" || request.deployStatus === "unknown";
  }
  return false;
}

function buildApprovalPayload(
  companyId: string,
  launchId: string,
  requestId: string,
  draft: CompanyTokenLaunchDraft,
  payload: BankrPartnerDeployRequest,
  simulation: BankrPartnerDeployResult,
) {
  return {
    tokenLaunchRequestId: requestId,
    tokenLaunchId: launchId,
    companyId,
    tokenName: payload.tokenName,
    tokenSymbol: payload.tokenSymbol ?? null,
    tokenDescription: payload.description ?? null,
    feeWalletAddress: payload.feeRecipient.value,
    companyWebsiteUrl: draft.companyWebsiteUrl,
    tokenWebsiteUrl: draft.tokenWebsiteUrl,
    businessSummary: draft.businessSummary,
    tractionSummary: draft.tractionSummary,
    launchRationale: draft.launchRationale,
    imageUrl: draft.imageUrl,
    tweetUrl: draft.tweetUrl,
    socialLinks: draft.socialLinks,
    simulation: {
      tokenAddress: simulation.tokenAddress,
      poolId: simulation.poolId,
      activityId: simulation.activityId,
      chain: simulation.chain,
      feeDistribution: simulation.feeDistribution ?? null,
    },
  } satisfies Record<string, unknown>;
}

export function tokenLaunchService(db: Db) {
  async function getWalletOptions(userId: string | null | undefined): Promise<TokenLaunchWalletOption[]> {
    if (!userId) return [];
    const rows = await db
      .select({
        address: userWalletLinks.address,
        chainType: userWalletLinks.chainType,
        walletType: userWalletLinks.walletType,
        walletClientType: userWalletLinks.walletClientType,
        connectorType: userWalletLinks.connectorType,
        isPrimary: userWalletLinks.isPrimary,
      })
      .from(userWalletLinks)
      .where(eq(userWalletLinks.userId, userId));

    const deduped = new Map<string, TokenLaunchWalletOption>();
    for (const row of rows) {
      if (!supportsLaunchWallet(row.chainType)) continue;
      const wallet = tokenLaunchWalletOptionSchema.parse(row);
      const key = normalizeWalletAddress(wallet.address);
      const existing = deduped.get(key);
      if (!existing || (!existing.isPrimary && wallet.isPrimary)) {
        deduped.set(key, wallet);
      }
    }
    return Array.from(deduped.values()).sort(walletSort);
  }

  async function ensureLaunchRow(companyId: string) {
    const existing = await db
      .select()
      .from(companyTokenLaunches)
      .where(eq(companyTokenLaunches.companyId, companyId))
      .then((rows) => rows[0] ?? null);
    if (existing) return existing;

    // Upsert: attempt insert, ignore unique-constraint conflict (race-safe)
    await db
      .insert(companyTokenLaunches)
      .values({ companyId })
      .onConflictDoNothing({ target: companyTokenLaunches.companyId });

    // Re-read — guaranteed to exist now
    return db
      .select()
      .from(companyTokenLaunches)
      .where(eq(companyTokenLaunches.companyId, companyId))
      .then((rows) => rows[0]!);
  }

  async function listRequestRows(launchId: string) {
    return db
      .select({
        request: companyTokenLaunchRequests,
        approvalStatus: approvals.status,
        decisionNote: approvals.decisionNote,
      })
      .from(companyTokenLaunchRequests)
      .innerJoin(approvals, eq(companyTokenLaunchRequests.approvalId, approvals.id))
      .where(eq(companyTokenLaunchRequests.launchId, launchId))
      .orderBy(desc(companyTokenLaunchRequests.createdAt));
  }

  async function getLaunch(companyId: string, userId: string | null | undefined): Promise<CompanyTokenLaunch> {
    const [launchRow, walletOptions] = await Promise.all([
      ensureLaunchRow(companyId),
      getWalletOptions(userId),
    ]);
    const requestRows = await listRequestRows(launchRow.id);
    const draft = buildDraft(launchRow, walletOptions);
    const latestSimulation = parseSimulation(launchRow.latestSimulation ?? null);
    return companyTokenLaunchSchema.parse({
      id: launchRow.id,
      companyId: launchRow.companyId,
      draft,
      walletOptions,
      latestSimulation,
      deployedTokenAddress: launchRow.deployedTokenAddress,
      deployedPoolId: launchRow.deployedPoolId,
      deployedTxHash: launchRow.deployedTxHash,
      deployedActivityId: launchRow.deployedActivityId,
      deployedChain: launchRow.deployedChain,
      deployedFeeDistribution: launchRow.deployedFeeDistribution ?? null,
      deployedAt: launchRow.deployedAt,
      deploymentUnknownAt: launchRow.deploymentUnknownAt,
      claimFeesUrl: buildClaimFeesUrl(launchRow.deployedTokenAddress),
      claimFeesDocsUrl: CLAIM_FEES_DOCS_URL,
      requests: requestRows.map(({ request, approvalStatus, decisionNote }) =>
        parseRequest(request, approvalStatus, decisionNote),
      ),
      createdAt: launchRow.createdAt,
      updatedAt: launchRow.updatedAt,
    });
  }

  async function updateLaunchDraft(
    companyId: string,
    userId: string | null | undefined,
    patch: CompanyTokenLaunchDraftUpdate,
  ) {
    const [launchRow, walletOptions] = await Promise.all([
      ensureLaunchRow(companyId),
      getWalletOptions(userId),
    ]);

    if (patch.selectedFeeWalletAddress) {
      const selected = walletOptions.some((wallet) => walletMatches(patch.selectedFeeWalletAddress, wallet));
      if (!selected) {
        throw unprocessable("Select one of your synced Base wallets.");
      }
    }

    const existingDraft = buildDraft(launchRow, walletOptions);
    const mergedDraft: CompanyTokenLaunchDraft = {
      ...existingDraft,
      ...patch,
      socialLinks: {
        ...existingDraft.socialLinks,
        ...(patch.socialLinks ?? {}),
      },
    };

    let nextFingerprint: string | null = null;
    try {
      nextFingerprint = buildSimulationFingerprint(buildBankrPayload(mergedDraft));
    } catch {
      nextFingerprint = null;
    }

    const shouldClearSimulation =
      launchRow.latestSimulationFingerprint !== null
      && launchRow.latestSimulationFingerprint !== nextFingerprint;

    const updated = await db
      .update(companyTokenLaunches)
      .set({
        stage: resolvePatch(patch.stage, launchRow.stage),
        companyWebsiteUrl: resolvePatch(patch.companyWebsiteUrl, launchRow.companyWebsiteUrl),
        businessSummary: resolvePatch(patch.businessSummary, launchRow.businessSummary),
        tractionSummary: resolvePatch(patch.tractionSummary, launchRow.tractionSummary),
        launchRationale: resolvePatch(patch.launchRationale, launchRow.launchRationale),
        socialLinks: {
          ...normalizeSocialLinks(launchRow.socialLinks),
          ...(patch.socialLinks ?? {}),
        },
        tokenName: resolvePatch(patch.tokenName, launchRow.tokenName),
        tokenSymbol: resolvePatch(patch.tokenSymbol, launchRow.tokenSymbol),
        tokenDescription: resolvePatch(patch.tokenDescription, launchRow.tokenDescription),
        imageUrl: resolvePatch(patch.imageUrl, launchRow.imageUrl),
        tweetUrl: resolvePatch(patch.tweetUrl, launchRow.tweetUrl),
        tokenWebsiteUrl: resolvePatch(patch.tokenWebsiteUrl, launchRow.tokenWebsiteUrl),
        selectedFeeWalletAddress: resolvePatch(patch.selectedFeeWalletAddress, launchRow.selectedFeeWalletAddress),
        latestSimulationFingerprint: shouldClearSimulation ? null : launchRow.latestSimulationFingerprint,
        latestSimulation: shouldClearSimulation ? null : launchRow.latestSimulation,
        latestSimulationAt: shouldClearSimulation ? null : launchRow.latestSimulationAt,
        updatedAt: new Date(),
      })
      .where(eq(companyTokenLaunches.id, launchRow.id))
      .returning()
      .then((rows) => rows[0]!);

    return getLaunch(updated.companyId, userId);
  }

  async function simulateLaunch(companyId: string, userId: string | null | undefined) {
    const [launchRow, walletOptions] = await Promise.all([
      ensureLaunchRow(companyId),
      getWalletOptions(userId),
    ]);
    if (isCompanyLocked(launchRow)) {
      throw conflict("This company is locked from further token launch actions.");
    }
    const draft = buildDraft(launchRow, walletOptions);
    const payload = buildBankrPayload(draft);
    const fingerprint = buildSimulationFingerprint(payload);

    let result: BankrPartnerDeployResult;
    try {
      result = await simulateTokenLaunchWithBankr(payload);
    } catch (err) {
      if (err instanceof BankrApiError) {
        throw unprocessable(err.message, { bankrStatus: err.status, bankrDetails: err.details });
      }
      throw err;
    }

    await db
      .update(companyTokenLaunches)
      .set({
        latestSimulationFingerprint: fingerprint,
        latestSimulation: companyTokenLaunchSimulationSchema.parse({
          fingerprint,
          request: { ...payload, simulateOnly: true },
          result,
          simulatedAt: new Date(),
        }),
        latestSimulationAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(companyTokenLaunches.id, launchRow.id));

    return getLaunch(companyId, userId);
  }

  async function submitLaunch(companyId: string, userId: string) {
    const [launchRow, walletOptions] = await Promise.all([
      ensureLaunchRow(companyId),
      getWalletOptions(userId),
    ]);
    if (isCompanyLocked(launchRow)) {
      throw conflict("This company is locked from further token launch actions.");
    }

    const draft = buildDraft(launchRow, walletOptions);
    if (!draft.selectedFeeWalletAddress || !walletOptions.some((wallet) => walletMatches(draft.selectedFeeWalletAddress, wallet))) {
      throw unprocessable("Select one of your synced Base wallets before submitting.");
    }

    const payload = buildBankrPayload(draft);
    const fingerprint = buildSimulationFingerprint(payload);
    const latestSimulation = parseSimulation(launchRow.latestSimulation ?? null);
    if (!latestSimulation || launchRow.latestSimulationFingerprint !== fingerprint) {
      throw unprocessable("Run a fresh simulation for the current draft before submitting.");
    }

    const existingRequests = (await listRequestRows(launchRow.id))
      .map(({ request, approvalStatus, decisionNote }) => parseRequest(request, approvalStatus, decisionNote));
    if (existingRequests.some(approvalBlocksNewSubmission)) {
      throw conflict("Resolve the current open token launch request before submitting another.");
    }

    await db.transaction(async (tx) => {
      const requestId = randomUUID();
      const approvalPayload = buildApprovalPayload(
        companyId,
        launchRow.id,
        requestId,
        draft,
        payload,
        latestSimulation.result,
      );
      const approval = await tx
        .insert(approvals)
        .values({
          companyId,
          type: "token_launch",
          requestedByAgentId: null,
          requestedByUserId: userId,
          status: "pending",
          payload: approvalPayload,
          decisionNote: null,
          decidedByUserId: null,
          decidedAt: null,
          updatedAt: new Date(),
        })
        .returning()
        .then((rows) => rows[0]!);

      await tx.insert(companyTokenLaunchRequests).values({
        id: requestId,
        companyId,
        launchId: launchRow.id,
        approvalId: approval.id,
        submittedByUserId: userId,
        feeWalletAddress: payload.feeRecipient.value,
        simulationFingerprint: fingerprint,
        bankrPayload: payload as unknown as Record<string, unknown>,
        simulationResult: latestSimulation.result as unknown as Record<string, unknown>,
        deployStatus: "not_started",
        deploymentError: null,
        deploymentErrorDetails: null,
        confirmedByUserId: null,
        confirmedAt: null,
        tokenAddress: null,
        poolId: null,
        txHash: null,
        activityId: null,
        chain: null,
        feeDistribution: null,
        deployedAt: null,
        updatedAt: new Date(),
      });
    });

    return getLaunch(companyId, userId);
  }

  async function confirmLaunch(companyId: string, requestId: string, userId: string) {
    const launchRow = await ensureLaunchRow(companyId);
    if (isCompanyLocked(launchRow)) {
      throw conflict("This company is locked from further token launch actions.");
    }

    const joined = await db
      .select({
        request: companyTokenLaunchRequests,
        approvalStatus: approvals.status,
        decisionNote: approvals.decisionNote,
      })
      .from(companyTokenLaunchRequests)
      .innerJoin(approvals, eq(companyTokenLaunchRequests.approvalId, approvals.id))
      .where(
        and(
          eq(companyTokenLaunchRequests.id, requestId),
          eq(companyTokenLaunchRequests.companyId, companyId),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (!joined) {
      throw notFound("Token launch request not found");
    }

    const request = parseRequest(joined.request, joined.approvalStatus, joined.decisionNote);
    if (request.submittedByUserId !== userId) {
      throw conflict("Only the original submitter can confirm this launch.");
    }
    if (request.approvalStatus !== "approved") {
      throw conflict("This token launch request has not been approved yet.");
    }
    if (request.deployStatus !== "not_started") {
      if (request.deployStatus === "deploying") {
        throw conflict("This token launch request is already being processed.");
      }
      if (request.deployStatus === "unknown") {
        throw conflict("This token launch request has an unknown live deploy outcome and is locked.");
      }
      throw conflict("This token launch request can no longer be confirmed.");
    }

    // Atomically claim the request to prevent concurrent deploys
    const claimed = await db
      .update(companyTokenLaunchRequests)
      .set({ deployStatus: "deploying", updatedAt: new Date() })
      .where(
        and(
          eq(companyTokenLaunchRequests.id, requestId),
          eq(companyTokenLaunchRequests.deployStatus, "not_started"),
        ),
      )
      .returning();
    if (claimed.length === 0) {
      throw conflict("This token launch request is already being processed or has been confirmed.");
    }

    try {
      const result = await liveDeployTokenWithBankr(request.bankrPayload);
      await db.transaction(async (tx) => {
        await tx
          .update(companyTokenLaunchRequests)
          .set({
            deployStatus: "deployed",
            deploymentError: null,
            deploymentErrorDetails: null,
            confirmedByUserId: userId,
            confirmedAt: new Date(),
            tokenAddress: result.tokenAddress,
            poolId: result.poolId,
            txHash: result.txHash ?? null,
            activityId: result.activityId,
            chain: result.chain,
            feeDistribution: result.feeDistribution ?? null,
            deployedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(companyTokenLaunchRequests.id, request.id));

        await tx
          .update(companyTokenLaunches)
          .set({
            selectedFeeWalletAddress: request.feeWalletAddress,
            deployedTokenAddress: result.tokenAddress,
            deployedPoolId: result.poolId,
            deployedTxHash: result.txHash ?? null,
            deployedActivityId: result.activityId,
            deployedChain: result.chain,
            deployedFeeDistribution: result.feeDistribution ?? null,
            deployedAt: new Date(),
            deploymentUnknownAt: null,
            updatedAt: new Date(),
          })
          .where(eq(companyTokenLaunches.id, launchRow.id));
      });
      return getLaunch(companyId, userId);
    } catch (err) {
      if (err instanceof BankrApiError) {
        // Reset to not_started so the user can retry
        await db
          .update(companyTokenLaunchRequests)
          .set({
            deployStatus: "not_started",
            deploymentError: err.message,
            deploymentErrorDetails: {
              bankrStatus: err.status,
              bankrDetails: err.details,
            },
            updatedAt: new Date(),
          })
          .where(eq(companyTokenLaunchRequests.id, request.id));
        throw unprocessable(err.message, {
          requestId: request.id,
          deployStatus: "not_started",
          bankrStatus: err.status,
          bankrDetails: err.details,
        });
      }

      if (err instanceof BankrRequestUncertainError) {
        await db.transaction(async (tx) => {
          await tx
            .update(companyTokenLaunchRequests)
            .set({
              deployStatus: "unknown",
              deploymentError: err.message,
              deploymentErrorDetails: err.details && typeof err.details === "object"
                ? (err.details as Record<string, unknown>)
                : { error: String(err.details ?? err.message) },
              confirmedByUserId: userId,
              confirmedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(companyTokenLaunchRequests.id, request.id));

          await tx
            .update(companyTokenLaunches)
            .set({
              deploymentUnknownAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(companyTokenLaunches.id, launchRow.id));
        });
        throw conflict(
          "Bankr did not return a definitive live deploy result. This company is now locked pending manual review.",
          {
            requestId: request.id,
            deployStatus: "unknown",
            bankrDetails: err.details,
          },
        );
      }

      throw err;
    }
  }

  return {
    getLaunch,
    updateLaunchDraft,
    simulateLaunch,
    submitLaunch,
    confirmLaunch,
  };
}
