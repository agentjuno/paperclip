import crypto from "node:crypto";
import type { Request } from "express";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { authUsers, userWalletLinks } from "@paperclipai/db";
import { isPrivyUserAllowed } from "./privy-allowlist.js";

export const COMPANY_SESSION_COOKIE_NAME =
  process.env.PAPERCLIP_COMPANY_SESSION_COOKIE_NAME?.trim() || "zhc_company_session";

export type CompanySessionWallet = {
  address: string;
  chainType: string | null;
  walletType: string;
  walletClientType: string | null;
  connectorType: string | null;
  isPrimary: boolean;
};

export type CompanySessionPayload = {
  userId: string;
  email: string | null;
  name: string | null;
  wallets: CompanySessionWallet[];
  issuedAt: number;
  expiresAt: number;
};

export type ResolvedSessionResult = {
  session: { id: string; userId: string };
  user: { id: string; email: string | null; name: string | null };
  wallets: CompanySessionWallet[];
};

function getCompanySessionSecret() {
  const secret =
    process.env.COMPANY_SESSION_SECRET?.trim()
    || process.env.PRIVY_SESSION_SECRET?.trim()
    || process.env.AUTH_SECRET?.trim();

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Missing COMPANY_SESSION_SECRET, PRIVY_SESSION_SECRET, or AUTH_SECRET in production");
    }

    return "dev-only-company-session-secret";
  }

  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("Company session secret must be at least 32 characters in production");
  }

  return secret;
}

export function getCompanySessionCookieDomain() {
  const configured =
    process.env.COMPANY_SESSION_COOKIE_DOMAIN?.trim()
    || process.env.PRIVY_SESSION_COOKIE_DOMAIN?.trim();
  return configured || undefined;
}

function signPayload(payloadBase64: string) {
  return crypto.createHmac("sha256", getCompanySessionSecret()).update(payloadBase64).digest("base64url");
}

function parseCookieValue(cookieHeader: string | null | undefined, cookieName: string) {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.split("=");
    if (!rawName || rest.length === 0) continue;
    if (rawName.trim() !== cookieName) continue;
    const rawValue = rest.join("=").trim();
    if (!rawValue) return null;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function buildWalletKey(wallet: CompanySessionWallet) {
  return [
    wallet.address.trim().toLowerCase(),
    wallet.chainType?.trim().toLowerCase() ?? "",
    wallet.walletType.trim().toLowerCase(),
  ].join("::");
}

function normalizeWallets(wallets: CompanySessionWallet[] | undefined): CompanySessionWallet[] {
  if (!Array.isArray(wallets)) return [];

  const deduped = new Map<string, CompanySessionWallet>();
  for (const wallet of wallets) {
    if (!wallet || typeof wallet !== "object") continue;
    if (typeof wallet.address !== "string" || typeof wallet.walletType !== "string") continue;
    const normalized: CompanySessionWallet = {
      address: wallet.address.trim(),
      chainType: typeof wallet.chainType === "string" ? wallet.chainType.trim() : null,
      walletType: wallet.walletType.trim(),
      walletClientType: typeof wallet.walletClientType === "string" ? wallet.walletClientType.trim() : null,
      connectorType: typeof wallet.connectorType === "string" ? wallet.connectorType.trim() : null,
      isPrimary: Boolean(wallet.isPrimary),
    };
    if (!normalized.address || !normalized.walletType) continue;
    deduped.set(buildWalletKey(normalized), normalized);
  }

  return Array.from(deduped.values());
}

export function verifyCompanySessionToken(token?: string | null): CompanySessionPayload | null {
  if (!token) return null;

  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) return null;

  const expected = signPayload(payloadBase64);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8")) as CompanySessionPayload;
    if (!payload.userId || payload.expiresAt < Date.now()) return null;
    return {
      ...payload,
      email: typeof payload.email === "string" ? payload.email : null,
      name: typeof payload.name === "string" ? payload.name : null,
      wallets: normalizeWallets(payload.wallets),
    };
  } catch {
    return null;
  }
}

async function syncCompanySessionUser(db: Db, payload: CompanySessionPayload): Promise<ResolvedSessionResult> {
  const now = new Date();
  const existingUser = await db
    .select({
      id: authUsers.id,
      email: authUsers.email,
      name: authUsers.name,
      emailVerified: authUsers.emailVerified,
    })
    .from(authUsers)
    .where(eq(authUsers.id, payload.userId))
    .then((rows) => rows[0] ?? null);

  const fallbackEmail = `${payload.userId}@privy.local`;
  const nextEmail = payload.email ?? existingUser?.email ?? fallbackEmail;
  const nextName = payload.name ?? existingUser?.name ?? "ZHC User";
  const emailVerified = payload.email ? true : (existingUser?.emailVerified ?? false);

  await db
    .insert(authUsers)
    .values({
      id: payload.userId,
      name: nextName,
      email: nextEmail,
      emailVerified,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: authUsers.id,
      set: {
        name: nextName,
        email: nextEmail,
        emailVerified,
        updatedAt: now,
      },
    });

  const wallets = normalizeWallets(payload.wallets);
  await db.transaction(async (tx) => {
    const existingWalletRows = await tx
      .select({
        id: userWalletLinks.id,
        address: userWalletLinks.address,
        chainType: userWalletLinks.chainType,
        walletType: userWalletLinks.walletType,
      })
      .from(userWalletLinks)
      .where(eq(userWalletLinks.userId, payload.userId));

    const activeWalletKeys = new Set(wallets.map((wallet) => buildWalletKey(wallet)));

    for (const wallet of wallets) {
      await tx
        .insert(userWalletLinks)
        .values({
          userId: payload.userId,
          address: wallet.address,
          chainType: wallet.chainType,
          walletType: wallet.walletType,
          walletClientType: wallet.walletClientType,
          connectorType: wallet.connectorType,
          isPrimary: wallet.isPrimary,
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            userWalletLinks.userId,
            userWalletLinks.address,
            userWalletLinks.chainType,
            userWalletLinks.walletType,
          ],
          set: {
            walletClientType: wallet.walletClientType,
            connectorType: wallet.connectorType,
            isPrimary: wallet.isPrimary,
            lastSyncedAt: now,
            updatedAt: now,
          },
        });
    }

    const staleIds = existingWalletRows
      .filter((row) =>
        !activeWalletKeys.has(
          buildWalletKey({
            address: row.address,
            chainType: row.chainType,
            walletType: row.walletType,
            walletClientType: null,
            connectorType: null,
            isPrimary: false,
          }),
        ),
      )
      .map((row) => row.id);

    if (staleIds.length > 0) {
      await tx.delete(userWalletLinks).where(inArray(userWalletLinks.id, staleIds));
    }
  });

  return {
    session: {
      id: `privy:${payload.userId}:${payload.issuedAt}`,
      userId: payload.userId,
    },
    user: {
      id: payload.userId,
      email: nextEmail,
      name: nextName,
    },
    wallets,
  };
}

async function resolveCompanySession(db: Db, cookieHeader: string | null | undefined) {
  const token = parseCookieValue(cookieHeader, COMPANY_SESSION_COOKIE_NAME);
  const payload = verifyCompanySessionToken(token);
  if (!payload) return null;
  if (!isPrivyUserAllowed({ userId: payload.userId, email: payload.email })) return null;
  return syncCompanySessionUser(db, payload);
}

export async function resolveCompanySessionFromRequest(db: Db, req: Request) {
  return resolveCompanySession(db, req.header("cookie"));
}

export async function resolveCompanySessionFromHeaders(db: Db, headers: Headers) {
  return resolveCompanySession(db, headers.get("cookie"));
}
