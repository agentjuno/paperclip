import { spawn as defaultSpawn, type ChildProcess } from "node:child_process";
import { logger } from "../middleware/logger.js";

/* ------------------------------------------------------------------ */
/*  Error types                                                        */
/* ------------------------------------------------------------------ */

export type StripeProjectsCliErrorCode =
  | "CLI_ERROR"
  | "TIMEOUT"
  | "PARSE_ERROR"
  | "NOT_FOUND"
  | "AUTH_EXPIRED"
  | "NETWORK_ERROR";

export class StripeProjectsCliError extends Error {
  readonly code: StripeProjectsCliErrorCode;
  readonly stderr?: string;
  readonly rawOutput?: string;

  constructor(
    code: StripeProjectsCliErrorCode,
    message: string,
    opts?: { stderr?: string; rawOutput?: string },
  ) {
    super(message);
    this.name = "StripeProjectsCliError";
    this.code = code;
    this.stderr = opts?.stderr;
    this.rawOutput = opts?.rawOutput;
  }
}

/* ------------------------------------------------------------------ */
/*  Credential redaction                                                */
/* ------------------------------------------------------------------ */

const CREDENTIAL_PATTERNS: RegExp[] = [
  // Stripe keys
  /sk_live_[A-Za-z0-9]{10,}/g,
  /sk_test_[A-Za-z0-9]{10,}/g,
  /pk_live_[A-Za-z0-9]{10,}/g,
  /pk_test_[A-Za-z0-9]{10,}/g,
  /rk_live_[A-Za-z0-9]{10,}/g,
  /rk_test_[A-Za-z0-9]{10,}/g,
  // Generic API key patterns (plain key=value and key: value)
  /api[_-]?key[=: ]+\S+/gi,
  /secret[=: ]+\S+/gi,
  // JSON-shaped key/value credential patterns ("api_key": "...", "secret": "...", etc.)
  /"(?:api[_-]?key|secret(?:[_-]?key)?|password|token|credential)"\s*:\s*"[^"]*"/gi,
  // Connection strings with credentials
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]+/gi,
  // Bearer tokens
  /bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

function redactCredentials(text: string): string {
  let redacted = text;
  for (const pattern of CREDENTIAL_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, "***REDACTED***");
  }
  return redacted;
}

/* ------------------------------------------------------------------ */
/*  Stderr classification                                              */
/* ------------------------------------------------------------------ */

const AUTH_PATTERNS = [
  /authenticat/i,
  /auth.*expired/i,
  /stripe login/i,
  /re-?authenticat/i,
  /unauthorized/i,
  /not logged in/i,
  /session.*expired/i,
];

const NETWORK_PATTERNS = [
  /could not connect/i,
  /network/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /no such host/i,
  /dns/i,
  /socket/i,
  /connection.*refused/i,
  /dial tcp/i,
];

function classifyStderr(stderr: string): StripeProjectsCliErrorCode {
  for (const pat of AUTH_PATTERNS) {
    if (pat.test(stderr)) return "AUTH_EXPIRED";
  }
  for (const pat of NETWORK_PATTERNS) {
    if (pat.test(stderr)) return "NETWORK_ERROR";
  }
  return "CLI_ERROR";
}

function buildErrorMessage(code: StripeProjectsCliErrorCode, stderr: string): string {
  switch (code) {
    case "AUTH_EXPIRED":
      return `Stripe authentication expired. Please run \`stripe login\` to re-authenticate. Details: ${redactCredentials(stderr.trim())}`;
    case "NETWORK_ERROR":
      return `Network error communicating with Stripe. Please check your internet connection and try again. Details: ${redactCredentials(stderr.trim())}`;
    default:
      return `Stripe CLI error: ${redactCredentials(stderr.trim())}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type SpawnFn = (
  command: string,
  args: string[],
  options: { shell: boolean; stdio: ["ignore", "pipe", "pipe"]; cwd?: string },
) => ChildProcess;

type LogFn = (...args: unknown[]) => void;

export interface ExecStripeProjectsCmdOptions {
  /** Injectable spawn function (defaults to child_process.spawn) */
  spawn?: SpawnFn;
  /** Timeout in milliseconds (defaults to 30_000) */
  timeoutMs?: number;
  /** Logger function for diagnostic output */
  log?: LogFn;
  /** Working directory for the CLI process */
  cwd?: string;
}

/* ------------------------------------------------------------------ */
/*  Main function                                                       */
/* ------------------------------------------------------------------ */

const DEFAULT_TIMEOUT_MS = 30_000;

export async function execStripeProjectsCmd(
  subcommand: string,
  args: string[] = [],
  options?: ExecStripeProjectsCmdOptions,
): Promise<unknown> {
  const spawnFn: SpawnFn = options?.spawn ?? (defaultSpawn as unknown as SpawnFn);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log: LogFn = options?.log ?? ((...a: unknown[]) => logger.debug(...a as [string]));

  const fullArgs = ["projects", subcommand, ...args, "--json", "-y"];

  log(redactCredentials(`Executing: stripe ${fullArgs.join(" ")}`));

  const spawnOpts: { shell: boolean; stdio: ["ignore", "pipe", "pipe"]; cwd?: string } = {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (options?.cwd) {
    spawnOpts.cwd = options.cwd;
  }

  const child = spawnFn("stripe", fullArgs, spawnOpts);

  return new Promise<unknown>((resolve, reject) => {
    let stdoutChunks: Buffer[] = [];
    let stderrChunks: Buffer[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function settle(fn: () => void) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      fn();
    }

    // Timeout handling
    timer = setTimeout(() => {
      if (settled) return;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore kill errors
      }
      settle(() =>
        reject(
          new StripeProjectsCliError(
            "TIMEOUT",
            `Stripe CLI command timed out after ${timeoutMs}ms: stripe projects ${subcommand}`,
          ),
        ),
      );
    }, timeoutMs);

    // Collect stdout
    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
    }

    // Collect stderr
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
    }

    // Handle spawn errors (e.g. ENOENT)
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        settle(() =>
          reject(
            new StripeProjectsCliError(
              "NOT_FOUND",
              "Stripe CLI not found. Please install it: https://docs.stripe.com/stripe-cli#install",
            ),
          ),
        );
      } else {
        settle(() =>
          reject(
            new StripeProjectsCliError("CLI_ERROR", `Failed to spawn Stripe CLI: ${err.message}`),
          ),
        );
      }
    });

    // Handle close
    child.on("close", (code: number | null) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");

      if (stderr) {
        log(redactCredentials(`stderr: ${stderr.trim()}`));
      }

      if (code !== 0) {
        // Shell-mode missing binary: shell exits 127, stderr contains "not found"
        if (
          code === 127 &&
          /command not found|not found/i.test(stderr)
        ) {
          settle(() =>
            reject(
              new StripeProjectsCliError(
                "NOT_FOUND",
                "Stripe CLI not found. Please install it: https://docs.stripe.com/stripe-cli#install",
                { stderr },
              ),
            ),
          );
          return;
        }

        const errorCode = classifyStderr(stderr);
        const message = buildErrorMessage(errorCode, stderr || `Process exited with code ${code}`);
        settle(() =>
          reject(new StripeProjectsCliError(errorCode, message, { stderr })),
        );
        return;
      }

      // Parse JSON stdout
      const trimmed = stdout.trim();
      if (!trimmed) {
        settle(() =>
          reject(
            new StripeProjectsCliError(
              "PARSE_ERROR",
              `Stripe CLI returned empty output for: stripe projects ${subcommand}`,
              { rawOutput: stdout },
            ),
          ),
        );
        return;
      }

      try {
        const parsed = JSON.parse(trimmed);
        log(redactCredentials(`Command succeeded: stripe projects ${subcommand}`));
        settle(() => resolve(parsed));
      } catch {
        settle(() =>
          reject(
            new StripeProjectsCliError(
              "PARSE_ERROR",
              `Failed to parse JSON output from Stripe CLI: ${redactCredentials(trimmed.slice(0, 200))}`,
              { rawOutput: trimmed },
            ),
          ),
        );
      }
    });
  });
}
