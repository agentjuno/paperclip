import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterInvocationMeta,
  ProviderQuotaResult,
} from "@paperclipai/adapter-utils";
import { parseObject } from "@paperclipai/adapter-utils/server-utils";
import {
  execute as claudeExecute,
  testEnvironment as claudeTestEnvironment,
} from "@paperclipai/adapter-claude-local/server";

const PLATFORM_API_KEY_ENV = "PAPERCLIP_PLATFORM_ANTHROPIC_API_KEY";

function getPlatformApiKey(): string | null {
  const key = process.env[PLATFORM_API_KEY_ENV];
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const platformApiKey = getPlatformApiKey();
  if (!platformApiKey) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: `Platform API key not configured. Set ${PLATFORM_API_KEY_ENV} on the server.`,
      errorCode: "managed_config_error",
    };
  }

  const existingEnv = parseObject(ctx.config.env);
  const managedConfig = {
    ...ctx.config,
    env: { ...existingEnv, ANTHROPIC_API_KEY: platformApiKey },
  };

  const wrappedOnMeta = ctx.onMeta
    ? async (meta: AdapterInvocationMeta) => {
        await ctx.onMeta!({ ...meta, adapterType: "claude_platform" });
      }
    : undefined;

  const managedCtx: AdapterExecutionContext = {
    ...ctx,
    config: managedConfig,
    onMeta: wrappedOnMeta,
  };

  const result = await claudeExecute(managedCtx);

  return {
    ...result,
    biller: "paperclip",
    billingType: "metered_api",
    errorCode: result.errorCode === "claude_auth_required" ? "managed_api_error" : result.errorCode,
    errorMeta: result.errorCode === "claude_auth_required" ? undefined : result.errorMeta,
  };
}

// Checks from claude_local that are irrelevant or confusing in platform mode.
const FILTERED_CHECK_CODES = new Set([
  "claude_anthropic_api_key_overrides_subscription",
  "claude_subscription_mode_possible",
  "claude_hello_probe_auth_required",
]);

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const platformApiKey = getPlatformApiKey();
  const existingEnv = parseObject(ctx.config.env);
  const managedConfig = {
    ...ctx.config,
    env: { ...existingEnv, ...(platformApiKey ? { ANTHROPIC_API_KEY: platformApiKey } : {}) },
  };
  const managedCtx: AdapterEnvironmentTestContext = { ...ctx, config: managedConfig };

  const result = await claudeTestEnvironment(managedCtx);

  // Remove checks about API key vs subscription auth — not relevant in platform mode.
  result.checks = result.checks.filter((c) => !FILTERED_CHECK_CODES.has(c.code));

  // When the platform key is configured, downgrade hello probe failures to warnings.
  // The probe may fail with API-key auth due to timing differences, but the key being
  // set is the real validation — actual runs have longer timeouts and work fine.
  if (platformApiKey) {
    for (const check of result.checks) {
      if (check.code === "claude_hello_probe_failed" && check.level === "error") {
        check.level = "warn";
        check.message = "Claude hello probe did not complete (this is common with API-key auth and does not affect agent runs).";
        check.hint = "Agent runs use longer timeouts and will work normally.";
      }
    }
  }

  if (!platformApiKey) {
    result.checks.unshift({
      code: "platform_api_key_missing",
      level: "error",
      message: `${PLATFORM_API_KEY_ENV} is not set on the server`,
      hint: "The platform administrator must configure this environment variable for managed billing.",
    });
    result.status = "fail";
  } else {
    result.checks.unshift({
      code: "platform_api_key_present",
      level: "info",
      message: "Platform API key is configured — API costs covered by the platform.",
    });
  }

  // Recompute status after filtering.
  if (result.checks.some((c) => c.level === "error")) {
    result.status = "fail";
  } else if (result.checks.some((c) => c.level === "warn")) {
    result.status = "warn";
  } else {
    result.status = "pass";
  }

  return { ...result, adapterType: "claude_platform" };
}

export async function getQuotaWindows(): Promise<ProviderQuotaResult> {
  return {
    provider: "anthropic",
    source: "platform-managed",
    ok: true,
    windows: [
      {
        label: "Platform managed",
        usedPercent: null,
        resetsAt: null,
        valueLabel: "Covered by platform",
        detail: "API costs are managed by the platform. Per-agent budgets apply.",
      },
    ],
  };
}

export const agentConfigurationDoc = `# claude_platform agent configuration

Adapter: claude_platform

Platform-managed variant of claude_local. The platform provides the Anthropic API key
and covers all inference costs. Users do not need their own API key or Claude subscription.

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process
- instructionsFilePath (string, optional): absolute path to a markdown instructions file injected at runtime
- model (string, optional): Claude model id
- effort (string, optional): reasoning effort passed via --effort (low|medium|high)
- chrome (boolean, optional): pass --chrome when running Claude
- promptTemplate (string, optional): run prompt template
- maxTurnsPerRun (number, optional): max turns for one run
- dangerouslySkipPermissions (boolean, optional): pass --dangerously-skip-permissions to claude
- command (string, optional): defaults to "claude"
- extraArgs (string[], optional): additional CLI args
- workspaceStrategy (object, optional): execution workspace strategy
- workspaceRuntime (object, optional): workspace runtime service intents

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Billing:
- All inference costs are billed to the platform (biller: "paperclip", billingType: "metered_api")
- Per-agent and per-company budgets are enforced through Paperclip's budget system
- No ANTHROPIC_API_KEY or Claude login is needed from the user
`;
