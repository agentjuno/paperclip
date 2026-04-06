/**
 * ZHC Auth Bridge Middleware
 *
 * Reads the `zhc_gating_session` cookie set by the zhc-nextjs app,
 * verifies its HMAC signature, and maps the wallet address to a
 * Paperclip user + company (auto-provisioning on first visit).
 *
 * This middleware runs BEFORE the standard actorMiddleware so that
 * it can inject a valid Paperclip session into the request.
 */
import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  authUsers,
  companies,
  companyMemberships,
  instanceUserRoles,
} from "@paperclipai/db";
import { logger } from "./logger.js";
import { ensureCompanyMailProvisioned } from "../services/agentmail.js";

// ── ZHC session format (mirrors zhc-nextjs/src/lib/gating/session.ts) ──

const ZHC_COOKIE_NAME = "zhc_gating_session";

interface ZhcSessionPayload {
  address: string; // 0x-prefixed wallet address
  chainId: number;
  issuedAt: number;
  expiresAt: number;
  entitlements: string[];
}

function verifyZhcToken(
  token: string,
  secret: string,
): ZhcSessionPayload | null {
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payloadBase64)
    .digest("base64url");

  if (signature.length !== expected.length) return null;
  if (
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadBase64, "base64url").toString("utf8"),
    ) as ZhcSessionPayload;
    if (payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Provisioning helpers ──

/** Deterministic Paperclip user-id for a wallet address */
function walletToUserId(address: string): string {
  return `zhc:${address.toLowerCase()}`;
}

/** Derive a short issue prefix from a wallet address */
function walletToIssuePrefix(address: string): string {
  // Use last 3 hex chars uppercased – collision-resistant enough for the
  // unique-index retry loop in companyService.
  return address.slice(-3).toUpperCase().replace(/[^A-Z0-9]/g, "Z");
}

async function ensureZhcUser(
  db: Db,
  address: string,
): Promise<string> {
  const userId = walletToUserId(address);
  const now = new Date();

  const existing = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .then((rows) => rows[0] ?? null);

  if (existing) return userId;

  await db.insert(authUsers).values({
    id: userId,
    name: `${address.slice(0, 6)}…${address.slice(-4)}`,
    email: `${address.toLowerCase()}@zhc.wallet`,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  });

  logger.info({ userId, address }, "ZHC bridge: provisioned Paperclip user");
  return userId;
}

async function ensureZhcCompany(
  db: Db,
  userId: string,
  address: string,
): Promise<string> {
  // Check if user already owns a company
  const membership = await db
    .select({ companyId: companyMemberships.companyId })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.principalId, userId),
        eq(companyMemberships.status, "active"),
        eq(companyMemberships.membershipRole, "owner"),
      ),
    )
    .then((rows) => rows[0] ?? null);

  if (membership) return membership.companyId;

  // Create a new company for this wallet
  const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const prefix = walletToIssuePrefix(address);

  // Retry loop for unique issue_prefix (mirrors companyService logic)
  let company: { id: string } | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? prefix : `${prefix}${"A".repeat(attempt)}`;
    try {
      const rows = await db
        .insert(companies)
        .values({
          name: `${shortAddr}'s Company`,
          description: `Auto-provisioned company for ZHC member ${address}`,
          issuePrefix: candidate,
        })
        .returning({ id: companies.id });
      company = rows[0];
      break;
    } catch (err: any) {
      if (err?.code !== "23505") throw err;
      // unique constraint violation – try next prefix
    }
  }

  if (!company) throw new Error("Failed to allocate unique issue prefix for ZHC company");

  // Make the user the owner
  await db.insert(companyMemberships).values({
    companyId: company.id,
    principalType: "user",
    principalId: userId,
    status: "active",
    membershipRole: "owner",
  });

  logger.info(
    { userId, address, companyId: company.id },
    "ZHC bridge: provisioned Paperclip company",
  );

  await ensureCompanyMailProvisioned(db, {
    companyId: company.id,
    companyName: `${shortAddr}'s Company`,
  });

  return company.id;
}

// ── Cookie parser helper ──

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

// ── Middleware factory ──

export interface ZhcAuthBridgeOptions {
  /** The GATING_SESSION_SECRET used by the zhc-nextjs app */
  sessionSecret: string;
  /** Required entitlement in the ZHC session (default: "dashboard") */
  requiredEntitlement?: string;
}

export function zhcAuthBridge(
  db: Db,
  opts: ZhcAuthBridgeOptions,
): RequestHandler {
  const requiredEntitlement = opts.requiredEntitlement ?? "dashboard";

  return async (req, _res, next) => {
    // Only run if no Authorization header (agent requests bypass this)
    if (req.header("authorization")) {
      next();
      return;
    }

    const cookies = parseCookies(req.header("cookie"));
    const token = cookies[ZHC_COOKIE_NAME];
    if (!token) {
      next();
      return;
    }

    const payload = verifyZhcToken(token, opts.sessionSecret);
    if (!payload) {
      next();
      return;
    }

    // Check entitlement
    if (
      !payload.entitlements.includes(requiredEntitlement) &&
      !payload.entitlements.includes("nitroReview")
    ) {
      next();
      return;
    }

    try {
      const userId = await ensureZhcUser(db, payload.address);
      const companyId = await ensureZhcCompany(db, userId, payload.address);

      // Inject the resolved actor so actorMiddleware picks it up
      req.actor = {
        type: "board",
        userId,
        companyIds: [companyId],
        isInstanceAdmin: false,
        source: "session" as const,
      };

      // Also fetch any additional company memberships the user may have
      const allMemberships = await db
        .select({ companyId: companyMemberships.companyId })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, userId),
            eq(companyMemberships.status, "active"),
          ),
        );
      req.actor.companyIds = allMemberships.map((m) => m.companyId);
    } catch (err) {
      logger.error({ err, address: payload.address }, "ZHC auth bridge: provisioning failed");
    }

    next();
  };
}
