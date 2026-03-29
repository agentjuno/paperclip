import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@/lib/router";
import { accessApi } from "../api/access";
import { authApi } from "../api/auth";
import { healthApi } from "../api/health";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AgentAdapterType, JoinRequest } from "@paperclipai/shared";
import { AlertTriangle, ShieldCheck, Users } from "lucide-react";
import { publicWebAdapterTypes } from "../lib/adapter-availability";

type JoinType = "human" | "agent";
const joinAdapterOptions: AgentAdapterType[] = [...publicWebAdapterTypes];
const ZHC_SITE_URL = (import.meta.env.VITE_ZHC_SITE_URL || "https://zhcinstitute.com").replace(/\/$/, "");

const adapterLabels: Record<string, string> = {
  openclaw_gateway: "OpenClaw Gateway",
  http: "HTTP",
};

function dateTime(value: string) {
  return new Date(value).toLocaleString();
}

function readNestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim().length > 0 ? current : null;
}

function frameShell(title: string, description: string, body: ReactNode, aside?: ReactNode) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.1),_transparent_32%),radial-gradient(circle_at_75%_18%,_rgba(255,255,255,0.05),_transparent_22%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mb-4 flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
          <span>Invite / onboarding</span>
          <Badge variant="outline" className="border-border/70 bg-background/50 text-[10px] uppercase tracking-[0.24em]">
            Access flow
          </Badge>
        </div>
        <div className="paperclip-panel paperclip-panel-strong flex flex-1 flex-col gap-6 rounded-[var(--paperclip-radius-shell)] p-5 sm:p-7 lg:p-8">
          <div className="space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Controlled entry point</span>
            </div>
            <div className="space-y-2">
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          </div>
          {aside ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div>{body}</div>
              <div className="space-y-4">{aside}</div>
            </div>
          ) : (
            body
          )}
        </div>
      </div>
    </div>
  );
}

export function InviteLandingPage() {
  const queryClient = useQueryClient();
  const params = useParams();
  const token = (params.token ?? "").trim();
  const [joinType, setJoinType] = useState<JoinType>("human");
  const [agentName, setAgentName] = useState("");
  const [adapterType, setAdapterType] = useState<AgentAdapterType>("openclaw_gateway");
  const [capabilities, setCapabilities] = useState("");
  const [result, setResult] = useState<{ kind: "bootstrap" | "join"; payload: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    retry: false,
  });
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const inviteQuery = useQuery({
    queryKey: queryKeys.access.invite(token),
    queryFn: () => accessApi.getInvite(token),
    enabled: token.length > 0,
    retry: false,
  });

  const invite = inviteQuery.data;
  const allowedJoinTypes = invite?.allowedJoinTypes ?? "both";
  const availableJoinTypes = useMemo(() => {
    if (invite?.inviteType === "bootstrap_ceo") return ["human"] as JoinType[];
    if (allowedJoinTypes === "both") return ["human", "agent"] as JoinType[];
    return [allowedJoinTypes] as JoinType[];
  }, [invite?.inviteType, allowedJoinTypes]);

  useEffect(() => {
    if (!availableJoinTypes.includes(joinType)) {
      setJoinType(availableJoinTypes[0] ?? "human");
    }
  }, [availableJoinTypes, joinType]);

  const requiresAuthForHuman =
    joinType === "human" &&
    healthQuery.data?.deploymentMode === "authenticated" &&
    !sessionQuery.data;

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!invite) throw new Error("Invite not found");
      if (joinType === "human") {
        return accessApi.acceptInvite(token, { requestType: "human" });
      }
      return accessApi.acceptInvite(token, {
        requestType: "agent",
        agentName: agentName.trim(),
        adapterType,
        capabilities: capabilities.trim() || null,
      });
    },
    onSuccess: async (payload) => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      const asBootstrap =
        payload && typeof payload === "object" && "bootstrapAccepted" in (payload as Record<string, unknown>);
      setResult({ kind: asBootstrap ? "bootstrap" : "join", payload });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to accept invite");
    },
  });

  if (!token) {
    return frameShell(
      "Invalid invite token",
      "The route is missing the invite token needed to continue.",
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Double-check the invite link.
      </div>,
    );
  }

  if (inviteQuery.isLoading || healthQuery.isLoading || sessionQuery.isLoading) {
    return frameShell(
      "Loading invite",
      "We are checking the invite, session state, and deployment mode.",
      <div className="paperclip-panel px-4 py-3 text-sm text-muted-foreground">
        Loading invite…
      </div>,
    );
  }

  if (inviteQuery.error || !invite) {
    return frameShell(
      "Invite not available",
      "This invite may be expired, revoked, or already used.",
      <div className="paperclip-panel border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <p className="text-sm text-muted-foreground">Use a fresh invite link from the instance owner.</p>
        </div>
      </div>,
    );
  }

  if (invite.inviteType === "bootstrap_ceo") {
    return frameShell(
      "Legacy bootstrap invite disabled",
      "Hosted access is now issued through ZHC accounts and shared Privy-backed sessions.",
      <div className="paperclip-panel border border-border/70 bg-background/50 p-5 text-sm text-muted-foreground">
        Instance bootstrap links are no longer accepted in this deployment. Open the main ZHC site
        and continue from your account instead.
        <div className="mt-4">
          <Button asChild className="h-11 rounded-lg">
            <a href={`${ZHC_SITE_URL}/dashboard`}>Open ZHC dashboard</a>
          </Button>
        </div>
      </div>,
    );
  }

  if (result?.kind === "bootstrap") {
    return frameShell(
      "Bootstrap complete",
      "The first instance admin is now configured.",
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
        <div className="paperclip-panel p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Instance admin created
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            You can continue to the board and begin configuring the instance.
          </p>
        </div>
        <Button asChild className="h-11 rounded-lg">
          <a href={`${ZHC_SITE_URL}/dashboard`}>Open ZHC dashboard</a>
        </Button>
      </div>,
    );
  }

  if (result?.kind === "join") {
    const payload = result.payload as JoinRequest & {
      claimSecret?: string;
      claimApiKeyPath?: string;
      onboarding?: Record<string, unknown>;
      diagnostics?: Array<{
        code: string;
        level: "info" | "warn";
        message: string;
        hint?: string;
      }>;
    };
    const claimSecret = typeof payload.claimSecret === "string" ? payload.claimSecret : null;
    const claimApiKeyPath = typeof payload.claimApiKeyPath === "string" ? payload.claimApiKeyPath : null;
    const onboardingSkillUrl = readNestedString(payload.onboarding, ["skill", "url"]);
    const onboardingSkillPath = readNestedString(payload.onboarding, ["skill", "path"]);
    const onboardingInstallPath = readNestedString(payload.onboarding, ["skill", "installPath"]);
    const onboardingTextUrl = readNestedString(payload.onboarding, ["textInstructions", "url"]);
    const onboardingTextPath = readNestedString(payload.onboarding, ["textInstructions", "path"]);
    const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
    return frameShell(
      "Join request submitted",
      "Your request is pending admin approval and access will remain blocked until it is approved.",
      <div className="paperclip-panel p-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Users className="h-4 w-4 text-emerald-400" />
          Pending review
        </div>
        <div className="mt-3 rounded-lg border border-border/70 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
          Request ID: <span className="font-mono text-foreground">{payload.id}</span>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          You will not have access until an administrator approves this request.
        </p>
      </div>,
      <div className="space-y-4">
        {claimSecret && claimApiKeyPath && (
          <div className="paperclip-panel p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">One-time claim secret</p>
            <p className="mt-2 font-mono break-all text-foreground">{claimSecret}</p>
            <p className="mt-2 font-mono break-all">POST {claimApiKeyPath}</p>
          </div>
        )}
        {(onboardingSkillUrl || onboardingSkillPath || onboardingInstallPath) && (
          <div className="paperclip-panel p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Paperclip skill bootstrap</p>
            {onboardingSkillUrl && <p className="mt-2 font-mono break-all text-foreground">GET {onboardingSkillUrl}</p>}
            {!onboardingSkillUrl && onboardingSkillPath && <p className="mt-2 font-mono break-all text-foreground">GET {onboardingSkillPath}</p>}
            {onboardingInstallPath && <p className="mt-2 font-mono break-all text-foreground">Install to {onboardingInstallPath}</p>}
          </div>
        )}
        {(onboardingTextUrl || onboardingTextPath) && (
          <div className="paperclip-panel p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Agent-readable onboarding text</p>
            {onboardingTextUrl && <p className="mt-2 font-mono break-all text-foreground">GET {onboardingTextUrl}</p>}
            {!onboardingTextUrl && onboardingTextPath && <p className="mt-2 font-mono break-all text-foreground">GET {onboardingTextPath}</p>}
          </div>
        )}
        {diagnostics.length > 0 && (
          <div className="paperclip-panel p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Connectivity diagnostics</p>
            <div className="mt-3 space-y-2">
              {diagnostics.map((diag, idx) => (
                <div key={`${diag.code}:${idx}`} className="space-y-0.5">
                  <p className={diag.level === "warn" ? "text-amber-400" : undefined}>
                    [{diag.level}] {diag.message}
                  </p>
                  {diag.hint && <p className="font-mono break-all text-foreground/80">{diag.hint}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>,
    );
  }

  return frameShell(
    "Join this Paperclip company",
    `Invite expires ${dateTime(invite.expiresAt)}.`,
    <div className="space-y-4">
      <div className="inline-flex rounded-full border border-border/70 bg-background/60 p-1 text-xs">
        {availableJoinTypes.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setJoinType(type)}
            className={`rounded-full px-3 py-1.5 transition-colors ${
              joinType === type
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Join as {type}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="paperclip-panel p-5">
          {joinType === "agent" ? (
            <div className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Agent name</span>
                <input
                  className="h-11 w-full rounded-lg border border-border/70 bg-background/60 px-3.5 text-sm outline-none focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/30"
                  value={agentName}
                  onChange={(event) => setAgentName(event.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Adapter type</span>
                <select
                  className="h-11 w-full rounded-lg border border-border/70 bg-background/60 px-3.5 text-sm outline-none focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/30"
                  value={adapterType}
                  onChange={(event) => setAdapterType(event.target.value as AgentAdapterType)}
                >
                  {joinAdapterOptions.map((type) => (
                    <option key={type} value={type}>
                      {adapterLabels[type]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Capabilities (optional)</span>
                <textarea
                  className="min-h-28 w-full rounded-lg border border-border/70 bg-background/60 px-3.5 py-3 text-sm outline-none focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/30"
                  rows={4}
                  value={capabilities}
                  onChange={(event) => setCapabilities(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              This invite will create a human account for this company.
            </p>
          )}

          {requiresAuthForHuman && (
            <div className="mt-4 rounded-lg border border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
              Continue from the main ZHC site before submitting a human join request.
              <div className="mt-3">
                <Button asChild size="sm" variant="outline" className="rounded-lg">
                  <a href={`${ZHC_SITE_URL}/dashboard`}>Continue with ZHC account</a>
                </Button>
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          <Button
            className="mt-5 h-11 rounded-lg"
            disabled={
              acceptMutation.isPending ||
              (joinType === "agent" && agentName.trim().length === 0) ||
              requiresAuthForHuman
            }
            onClick={() => acceptMutation.mutate()}
          >
            {acceptMutation.isPending ? "Submitting…" : "Submit join request"}
          </Button>
        </div>

        <div className="space-y-4">
          <div className="paperclip-panel p-4 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Invite details</p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span>Type</span>
                <span className="text-foreground">{invite.inviteType}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Allowed join types</span>
                <span className="text-foreground">{allowedJoinTypes}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Expires</span>
                <span className="text-foreground">{dateTime(invite.expiresAt)}</span>
              </div>
            </div>
          </div>

          {healthQuery.data?.deploymentMode && (
            <div className="paperclip-panel p-4 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Deployment mode</p>
              <p className="mt-2 text-foreground">{healthQuery.data.deploymentMode}</p>
              {joinType === "human" && requiresAuthForHuman && (
                <p className="mt-2 text-amber-400">Authenticated deployment requires sign in for human requests.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
  );
}
