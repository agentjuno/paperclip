import type { Request } from "express";
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  companyTokenLaunchDraftUpdateSchema,
  tokenLaunchConfirmRequestSchema,
  tokenLaunchSimulationRequestSchema,
  tokenLaunchSubmitRequestSchema,
} from "@paperclipai/shared";
import { conflict, forbidden, unauthorized } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { logActivity, tokenLaunchService } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

function assertBoardUser(req: Request, companyId: string) {
  assertCompanyAccess(req, companyId);
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
  if (!req.actor.userId) {
    throw unauthorized();
  }
  return req.actor.userId;
}

export function tokenLaunchRoutes(db: Db) {
  const router = Router();
  const svc = tokenLaunchService(db);

  router.get("/companies/:companyId/token-launch", async (req, res) => {
    const companyId = req.params.companyId as string;
    const userId = assertBoardUser(req, companyId);
    const launch = await svc.getLaunch(companyId, userId);
    res.json(launch);
  });

  router.patch(
    "/companies/:companyId/token-launch",
    validate(companyTokenLaunchDraftUpdateSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const userId = assertBoardUser(req, companyId);
      const launch = await svc.updateLaunchDraft(companyId, userId, req.body);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "token_launch.updated",
        entityType: "company_token_launch",
        entityId: launch.id,
        details: {
          selectedFeeWalletAddress: launch.draft.selectedFeeWalletAddress,
          tokenName: launch.draft.tokenName,
        },
      });
      res.json(launch);
    },
  );

  router.post(
    "/companies/:companyId/token-launch/simulate",
    validate(tokenLaunchSimulationRequestSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const userId = assertBoardUser(req, companyId);
      const launch = await svc.simulateLaunch(companyId, userId);
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "token_launch.simulated",
        entityType: "company_token_launch",
        entityId: launch.id,
        details: {
          fingerprint: launch.latestSimulation?.fingerprint ?? null,
          simulatedTokenAddress: launch.latestSimulation?.result.tokenAddress ?? null,
          simulatedPoolId: launch.latestSimulation?.result.poolId ?? null,
        },
      });
      res.json(launch);
    },
  );

  router.post(
    "/companies/:companyId/token-launch/submit",
    validate(tokenLaunchSubmitRequestSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const userId = assertBoardUser(req, companyId);
      const launch = await svc.submitLaunch(companyId, userId);
      const latestRequest = launch.requests[0] ?? null;
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "token_launch.submitted",
        entityType: "company_token_launch_request",
        entityId: latestRequest?.id ?? launch.id,
        details: {
          approvalId: latestRequest?.approvalId ?? null,
          tokenName: latestRequest?.bankrPayload.tokenName ?? launch.draft.tokenName,
          feeWalletAddress: latestRequest?.feeWalletAddress ?? launch.draft.selectedFeeWalletAddress,
        },
      });
      res.status(201).json(launch);
    },
  );

  router.post(
    "/companies/:companyId/token-launch/requests/:requestId/confirm",
    validate(tokenLaunchConfirmRequestSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const requestId = req.params.requestId as string;
      const userId = assertBoardUser(req, companyId);
      const actor = getActorInfo(req);

      try {
        const launch = await svc.confirmLaunch(companyId, requestId, userId);
        const deployedRequest = launch.requests.find((request) => request.id === requestId) ?? launch.requests[0] ?? null;
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: "token_launch.deployed",
          entityType: "company_token_launch_request",
          entityId: requestId,
          details: {
            tokenAddress: deployedRequest?.tokenAddress ?? launch.deployedTokenAddress,
            txHash: deployedRequest?.txHash ?? launch.deployedTxHash,
            activityId: deployedRequest?.activityId ?? launch.deployedActivityId,
          },
        });
        res.json(launch);
      } catch (err) {
        if (err instanceof Error && "details" in err) {
          const details = (err as { details?: unknown }).details;
          if (details && typeof details === "object") {
            const record = details as Record<string, unknown>;
            const deployStatus = typeof record.deployStatus === "string" ? record.deployStatus : null;
            const requestEntityId = typeof record.requestId === "string" ? record.requestId : requestId;
            if (deployStatus === "failed" || deployStatus === "unknown") {
              await logActivity(db, {
                companyId,
                actorType: actor.actorType,
                actorId: actor.actorId,
                action: deployStatus === "unknown" ? "token_launch.deploy_unknown" : "token_launch.deploy_failed",
                entityType: "company_token_launch_request",
                entityId: requestEntityId,
                details: record,
              });
            }
          }
        }
        throw err;
      }
    },
  );

  return router;
}
