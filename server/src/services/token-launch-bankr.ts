import type {
  BankrPartnerDeployRequest,
  BankrPartnerDeployResult,
} from "@paperclipai/shared";
import { bankrPartnerDeployResultSchema } from "@paperclipai/shared";

const DEFAULT_BANKR_API_BASE_URL = "https://api.bankr.bot";
const DEFAULT_TIMEOUT_MS = 20_000;

export class BankrApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "BankrApiError";
    this.status = status;
    this.details = details;
  }
}

export class BankrRequestUncertainError extends Error {
  details: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "BankrRequestUncertainError";
    this.details = details ?? null;
  }
}

function getBankrApiBaseUrl() {
  return process.env.BANKR_API_BASE_URL?.trim() || DEFAULT_BANKR_API_BASE_URL;
}

function getBankrPartnerKey() {
  const key = process.env.BANKR_PARTNER_KEY?.trim();
  if (!key) {
    throw new Error("Missing BANKR_PARTNER_KEY");
  }
  return key;
}

function getTimeoutMs() {
  const raw = Number(process.env.BANKR_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

async function parseResponseBody(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessageFromBody(body: unknown, fallback: string) {
  if (!body) return fallback;
  if (typeof body === "string") return body;
  if (typeof body === "object") {
    const message =
      (body as { error?: unknown }).error
      ?? (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return fallback;
}

type DeployOptions = {
  allowUncertainOutcome: boolean;
};

async function deploy(
  payload: BankrPartnerDeployRequest,
  options: DeployOptions,
): Promise<BankrPartnerDeployResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  const url = `${getBankrApiBaseUrl().replace(/\/+$/, "")}/token-launches/deploy`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Partner-Key": getBankrPartnerKey(),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw new BankrApiError(
        errorMessageFromBody(body, `Bankr request failed (${response.status})`),
        response.status,
        body,
      );
    }

    try {
      return bankrPartnerDeployResultSchema.parse(body);
    } catch (err) {
      if (options.allowUncertainOutcome) {
        throw new BankrRequestUncertainError(
          "Bankr returned an unexpected deploy response after accepting the request.",
          {
            cause: err instanceof Error ? err.message : String(err),
            body,
          },
        );
      }
      throw err;
    }
  } catch (err) {
    if (err instanceof BankrApiError || err instanceof BankrRequestUncertainError) {
      throw err;
    }
    if (options.allowUncertainOutcome) {
      throw new BankrRequestUncertainError(
        "Bankr deploy request did not return a definitive result.",
        err instanceof Error ? { message: err.message, name: err.name } : { error: String(err) },
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function simulateTokenLaunchWithBankr(payload: BankrPartnerDeployRequest) {
  return deploy({ ...payload, simulateOnly: true }, { allowUncertainOutcome: false });
}

export function liveDeployTokenWithBankr(payload: BankrPartnerDeployRequest) {
  return deploy({ ...payload, simulateOnly: false }, { allowUncertainOutcome: true });
}

