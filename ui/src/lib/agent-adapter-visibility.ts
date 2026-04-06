import type { AgentAdapterType } from "@paperclipai/shared";

const EXPANDED_AGENT_ADAPTER_EMAIL_ALLOWLIST = new Set([
  "tomcharlesosman@gmail.com",
  "local@paperclip.local",
]);

const RESTRICTED_VISIBLE_AGENT_ADAPTER_TYPES = [
  "claude_platform",
  "openclaw_gateway",
  "http",
] as const;

type VisibilityOptions = {
  restrictWhenEmailMissing?: boolean;
};

export function normalizeAgentAdapterVisibilityEmail(
  email: string | null | undefined,
): string | null {
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function shouldRestrictAgentAdapterCatalog(
  email: string | null | undefined,
  opts: VisibilityOptions = {},
): boolean {
  const normalized = normalizeAgentAdapterVisibilityEmail(email);
  if (!normalized) {
    return Boolean(opts.restrictWhenEmailMissing);
  }
  return !EXPANDED_AGENT_ADAPTER_EMAIL_ALLOWLIST.has(normalized);
}

export function filterVisibleAgentAdapterTypes<T extends string>(
  types: readonly T[],
  email: string | null | undefined,
  opts: VisibilityOptions & { preserveTypes?: readonly T[] } = {},
): T[] {
  if (!shouldRestrictAgentAdapterCatalog(email, opts)) {
    return [...types];
  }

  const allowedTypes = new Set<string>([
    ...RESTRICTED_VISIBLE_AGENT_ADAPTER_TYPES,
    ...(opts.preserveTypes ?? []),
  ]);

  return types.filter((type) => allowedTypes.has(type));
}

export function getDefaultVisibleAgentAdapterType(
  email: string | null | undefined,
  opts: VisibilityOptions & { fallback?: AgentAdapterType } = {},
): AgentAdapterType {
  return shouldRestrictAgentAdapterCatalog(email, opts)
    ? "claude_platform"
    : (opts.fallback ?? "claude_local");
}
