import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CompanyTokenLaunch,
  CompanyTokenLaunchDraft,
  CompanyTokenLaunchRequest,
  TokenLaunchWalletOption,
} from "@paperclipai/shared";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  FlaskConical,
  Rocket,
  ShieldCheck,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { assetsApi } from "../api/assets";
import { authApi } from "../api/auth";
import { tokenLaunchApi } from "../api/tokenLaunch";
import { PageSkeleton } from "../components/PageSkeleton";
import { Field } from "../components/agent-config-primitives";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatDateTime } from "../lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type TokenLaunchFormState = {
  stage: string;
  companyWebsiteUrl: string;
  businessSummary: string;
  tractionSummary: string;
  launchRationale: string;
  socialLinks: {
    x: string;
    farcaster: string;
    telegram: string;
    discord: string;
  };
  tokenName: string;
  tokenSymbol: string;
  tokenDescription: string;
  imageUrl: string;
  tweetUrl: string;
  tokenWebsiteUrl: string;
  selectedFeeWalletAddress: string;
};

function emptyFormState(): TokenLaunchFormState {
  return {
    stage: "",
    companyWebsiteUrl: "",
    businessSummary: "",
    tractionSummary: "",
    launchRationale: "",
    socialLinks: {
      x: "",
      farcaster: "",
      telegram: "",
      discord: "",
    },
    tokenName: "",
    tokenSymbol: "",
    tokenDescription: "",
    imageUrl: "",
    tweetUrl: "",
    tokenWebsiteUrl: "",
    selectedFeeWalletAddress: "",
  };
}

function toFormState(draft: CompanyTokenLaunchDraft): TokenLaunchFormState {
  return {
    stage: draft.stage ?? "",
    companyWebsiteUrl: draft.companyWebsiteUrl ?? "",
    businessSummary: draft.businessSummary ?? "",
    tractionSummary: draft.tractionSummary ?? "",
    launchRationale: draft.launchRationale ?? "",
    socialLinks: {
      x: draft.socialLinks.x ?? "",
      farcaster: draft.socialLinks.farcaster ?? "",
      telegram: draft.socialLinks.telegram ?? "",
      discord: draft.socialLinks.discord ?? "",
    },
    tokenName: draft.tokenName ?? "",
    tokenSymbol: draft.tokenSymbol ?? "",
    tokenDescription: draft.tokenDescription ?? "",
    imageUrl: draft.imageUrl ?? "",
    tweetUrl: draft.tweetUrl ?? "",
    tokenWebsiteUrl: draft.tokenWebsiteUrl ?? "",
    selectedFeeWalletAddress: draft.selectedFeeWalletAddress ?? "",
  };
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toDraftPayload(form: TokenLaunchFormState): CompanyTokenLaunchDraft {
  return {
    stage: optionalText(form.stage),
    companyWebsiteUrl: optionalText(form.companyWebsiteUrl),
    businessSummary: optionalText(form.businessSummary),
    tractionSummary: optionalText(form.tractionSummary),
    launchRationale: optionalText(form.launchRationale),
    socialLinks: {
      x: optionalText(form.socialLinks.x),
      farcaster: optionalText(form.socialLinks.farcaster),
      telegram: optionalText(form.socialLinks.telegram),
      discord: optionalText(form.socialLinks.discord),
    },
    tokenName: optionalText(form.tokenName),
    tokenSymbol: optionalText(form.tokenSymbol),
    tokenDescription: optionalText(form.tokenDescription),
    imageUrl: optionalText(form.imageUrl),
    tweetUrl: optionalText(form.tweetUrl),
    tokenWebsiteUrl: optionalText(form.tokenWebsiteUrl),
    selectedFeeWalletAddress: optionalText(form.selectedFeeWalletAddress),
  };
}

function draftsEqual(a: CompanyTokenLaunchDraft, b: CompanyTokenLaunchDraft) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function shortAddress(value: string | null | undefined) {
  if (!value) return "—";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function feeShareLabel(bps: number) {
  const percent = bps / 100;
  if (Number.isInteger(percent)) return `${percent}%`;
  return `${percent.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function walletLabel(wallet: TokenLaunchWalletOption) {
  const connector = wallet.connectorType || wallet.walletClientType || wallet.walletType;
  return `${shortAddress(wallet.address)}${connector ? ` · ${connector}` : ""}${wallet.isPrimary ? " · primary" : ""}`;
}

function computeLaunchReadiness(
  draft: CompanyTokenLaunchDraft,
  hasWalletOptions: boolean,
) {
  const checks = [
    { label: "company stage", complete: Boolean(draft.stage), points: 8 },
    { label: "company website", complete: Boolean(draft.companyWebsiteUrl), points: 8 },
    { label: "business summary", complete: Boolean(draft.businessSummary), points: 15 },
    { label: "traction summary", complete: Boolean(draft.tractionSummary), points: 15 },
    { label: "launch rationale", complete: Boolean(draft.launchRationale), points: 15 },
    {
      label: "social proof",
      complete: Object.values(draft.socialLinks).some(Boolean),
      points: 6,
    },
    { label: "token name", complete: Boolean(draft.tokenName), points: 10 },
    { label: "token symbol", complete: Boolean(draft.tokenSymbol), points: 6 },
    { label: "token description", complete: Boolean(draft.tokenDescription), points: 10 },
    { label: "launch image", complete: Boolean(draft.imageUrl), points: 3 },
    {
      label: "fee wallet",
      complete: hasWalletOptions && Boolean(draft.selectedFeeWalletAddress),
      points: 4,
    },
  ] as const;

  const score = checks.reduce(
    (total, check) => total + (check.complete ? check.points : 0),
    0,
  );
  const missingSignals = checks
    .filter((check) => !check.complete)
    .map((check) => check.label);

  return {
    score,
    missingSignals,
    isEligible:
      score >= 70 && hasWalletOptions && Boolean(draft.selectedFeeWalletAddress),
  };
}

function StatusPill({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "success" | "warn" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        tone === "success" && "border-emerald-400/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
        tone === "warn" && "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "danger" && "border-red-400/40 bg-red-500/10 text-red-700 dark:text-red-300",
        tone === "default" && "border-border/70 bg-background/60 text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function FeeDistributionList({
  distribution,
}: {
  distribution: CompanyTokenLaunch["deployedFeeDistribution"] | CompanyTokenLaunchRequest["feeDistribution"];
}) {
  const entries = Object.entries(distribution ?? {});
  if (entries.length === 0) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {entries.map(([key, value]) => {
        if (!value) return null;
        return (
          <div key={key} className="rounded-xl border border-border/70 bg-background/50 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {key}
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{feeShareLabel(value.bps)}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {shortAddress(value.address)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RequestRow({
  request,
  canConfirm,
  isConfirming,
  onConfirm,
}: {
  request: CompanyTokenLaunchRequest;
  canConfirm: boolean;
  isConfirming: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/50 p-4 space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium">
              {request.bankrPayload.tokenName}
              {request.bankrPayload.tokenSymbol ? ` ($${request.bankrPayload.tokenSymbol})` : ""}
            </div>
            <StatusPill
              label={statusLabel(request.approvalStatus)}
              tone={request.approvalStatus === "approved" ? "success" : request.approvalStatus === "rejected" ? "danger" : request.approvalStatus === "revision_requested" ? "warn" : "default"}
            />
            <StatusPill
              label={statusLabel(request.deployStatus)}
              tone={request.deployStatus === "deployed" ? "success" : request.deployStatus === "failed" || request.deployStatus === "unknown" ? "danger" : "default"}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Submitted {formatDateTime(request.createdAt)} · Fee wallet {shortAddress(request.feeWalletAddress)}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to={`/approvals/${request.approvalId}`}>Open approval</Link>
          </Button>
          {canConfirm && (
            <Button size="sm" onClick={onConfirm} disabled={isConfirming}>
              {isConfirming ? "Confirming..." : "Confirm launch"}
            </Button>
          )}
        </div>
      </div>

      {request.decisionNote && (
        <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
          {request.decisionNote}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Simulation</div>
          <div className="mt-1 text-sm font-medium">
            {shortAddress(request.simulationResult.tokenAddress)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Pool {request.simulationResult.poolId} · {request.simulationResult.chain}
          </div>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Deployment</div>
          <div className="mt-1 text-sm font-medium">
            {request.tokenAddress ? shortAddress(request.tokenAddress) : statusLabel(request.deployStatus)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {request.txHash ? `Tx ${shortAddress(request.txHash)}` : request.deploymentError ?? "Awaiting live deploy"}
          </div>
        </div>
      </div>

      <FeeDistributionList distribution={request.feeDistribution ?? request.simulationResult.feeDistribution ?? null} />
    </div>
  );
}

export function TokenLaunch() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<TokenLaunchFormState>(emptyFormState());
  const [actionError, setActionError] = useState<string | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/command-center" },
      { label: "Token Launch" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  const launchQuery = useQuery({
    queryKey: queryKeys.tokenLaunch.detail(selectedCompanyId ?? ""),
    queryFn: () => tokenLaunchApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const launch = launchQuery.data ?? null;
  const currentUserId = sessionQuery.data?.user.id ?? sessionQuery.data?.session.userId ?? null;
  const draftPayload = useMemo(() => toDraftPayload(formState), [formState]);
  const isDirty = launch ? !draftsEqual(draftPayload, launch.draft) : false;
  const companyLocked = Boolean(launch?.deployedTokenAddress || launch?.deploymentUnknownAt);
  const hasWalletOptions = (launch?.walletOptions.length ?? 0) > 0;
  const launchReadiness = useMemo(
    () => computeLaunchReadiness(draftPayload, hasWalletOptions),
    [draftPayload, hasWalletOptions],
  );
  const busy =
    launchQuery.isFetching
    || sessionQuery.isFetching
    || false;

  useEffect(() => {
    if (launch?.draft) {
      setFormState(toFormState(launch.draft));
      setActionError(null);
      setImageUploadError(null);
      return;
    }
    if (!selectedCompanyId) {
      setFormState(emptyFormState());
      setActionError(null);
      setImageUploadError(null);
    }
  }, [launch?.draft, selectedCompanyId]);

  function syncLaunch(next: CompanyTokenLaunch, options?: { invalidateApprovals?: boolean }) {
    if (!selectedCompanyId) return;
    queryClient.setQueryData(queryKeys.tokenLaunch.detail(selectedCompanyId), next);
    if (options?.invalidateApprovals) {
      queryClient.invalidateQueries({ queryKey: ["approvals", selectedCompanyId] });
    }
  }

  const saveMutation = useMutation({
    mutationFn: ({
      draft,
      silent,
    }: {
      draft: CompanyTokenLaunchDraft;
      silent?: boolean;
    }) => tokenLaunchApi.update(selectedCompanyId!, draft).then((next) => ({ next, silent: silent ?? false })),
    onSuccess: ({ next, silent }) => {
      syncLaunch(next);
      setFormState(toFormState(next.draft));
      setActionError(null);
      if (!silent) {
        pushToast({
          tone: "success",
          title: "Draft saved",
          body: "Token launch fields are stored for this company.",
        });
      }
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Failed to save draft";
      setActionError(message);
      pushToast({ tone: "error", title: "Save failed", body: message });
    },
  });

  const imageUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedCompanyId) throw new Error("Select a company first.");
      return assetsApi.uploadImage(selectedCompanyId, file, `token-launch/${selectedCompanyId}`);
    },
    onSuccess: (asset) => {
      setFormState((current) => ({ ...current, imageUrl: asset.contentPath }));
      setImageUploadError(null);
      pushToast({
        tone: "success",
        title: "Image uploaded",
        body: "Token artwork was added to the draft.",
      });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Image upload failed";
      setImageUploadError(message);
      pushToast({ tone: "error", title: "Upload failed", body: message });
    },
  });

  async function persistDraftIfNeeded() {
    if (!selectedCompanyId) {
      throw new Error("Select a company first.");
    }
    if (!launch || isDirty) {
      const result = await saveMutation.mutateAsync({ draft: draftPayload, silent: true });
      return result.next;
    }
    return launch;
  }

  function handleTokenImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setImageUploadError(null);
    imageUploadMutation.mutate(file);
  }

  function handleClearTokenImage() {
    setImageUploadError(null);
    setFormState((current) => ({ ...current, imageUrl: "" }));
  }

  const simulateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("Select a company first.");
      await persistDraftIfNeeded();
      return tokenLaunchApi.simulate(selectedCompanyId);
    },
    onSuccess: (next) => {
      syncLaunch(next);
      setFormState(toFormState(next.draft));
      setActionError(null);
      pushToast({
        tone: "success",
        title: "Simulation complete",
        body: "Bankr returned a simulated token launch result for the current draft.",
      });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Simulation failed";
      setActionError(message);
      pushToast({ tone: "error", title: "Simulation failed", body: message });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) throw new Error("Select a company first.");
      await persistDraftIfNeeded();
      return tokenLaunchApi.submit(selectedCompanyId);
    },
    onSuccess: (next) => {
      syncLaunch(next, { invalidateApprovals: true });
      setFormState(toFormState(next.draft));
      setActionError(null);
      pushToast({
        tone: "success",
        title: "Submitted for review",
        body: "The request is now in the company approvals queue.",
        action: next.requests[0]
          ? { label: "Open approval", href: `/approvals/${next.requests[0].approvalId}` }
          : undefined,
      });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Submit failed";
      setActionError(message);
      pushToast({ tone: "error", title: "Submit failed", body: message });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (requestId: string) => {
      if (!selectedCompanyId) throw new Error("Select a company first.");
      return tokenLaunchApi.confirm(selectedCompanyId, requestId);
    },
    onSuccess: (next) => {
      syncLaunch(next);
      setFormState(toFormState(next.draft));
      setActionError(null);
      pushToast({
        tone: "success",
        title: "Token launched",
        body: next.deployedTokenAddress
          ? `Live deploy completed for ${shortAddress(next.deployedTokenAddress)}.`
          : "The launch completed successfully.",
      });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Confirm failed";
      setActionError(message);
      pushToast({ tone: "error", title: "Confirm failed", body: message });
    },
  });

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }

  if (launchQuery.isLoading) {
    return <PageSkeleton variant="detail" />;
  }

  if (launchQuery.error) {
    return (
      <div className="paperclip-panel px-5 py-4 text-sm text-destructive">
        {launchQuery.error instanceof Error ? launchQuery.error.message : "Failed to load token launch workspace."}
      </div>
    );
  }

  if (!launch) {
    return <p className="text-sm text-muted-foreground">Token launch workspace unavailable.</p>;
  }

  const simulation = launch.latestSimulation;
  const latestRequest = launch.requests[0] ?? null;
  const scoreTone = launchReadiness.isEligible ? "success" : "warn";
  const readinessSummary = launch.deployedTokenAddress
    ? "This company already has a deployed token. The score remains a placeholder reference until formal scoring ships."
    : launchReadiness.isEligible
      ? "Placeholder threshold met. Final launch approval still runs through Compliance."
      : `Placeholder threshold not met yet. Add ${launchReadiness.missingSignals
          .slice(0, 3)
          .join(", ")}${launchReadiness.missingSignals.length > 3 ? ", and more" : ""}.`;

  return (
    <div className="space-y-6">
      <section className="paperclip-panel paperclip-panel-strong command-fade-up p-5 sm:p-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]">
          <div className="space-y-4">
            <div className="paperclip-kicker flex items-center gap-3">
              <span>Governance / Launch</span>
              <span className="h-px w-8 bg-border/80" />
              <span>{selectedCompany?.issuePrefix ?? "Company"}</span>
            </div>
            <div className="flex items-start gap-3">
              <div className="mt-1 rounded-2xl border border-primary/20 bg-primary/10 p-3 text-primary">
                <Coins className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Token Launch
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Prepare a Bankr launch dossier, run a simulation, submit it through the existing approvals queue, and confirm the live deploy only after approval.
                </p>
              </div>
            </div>
          </div>

          <div className="paperclip-panel space-y-4 px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="paperclip-kicker">Company Score</div>
                <div className="mt-2 flex items-end gap-2">
                  <span className="text-4xl font-semibold tabular-nums">
                    {launchReadiness.score}
                  </span>
                  <span className="pb-1 text-sm text-muted-foreground">/ 100</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant="outline">Placeholder</Badge>
                <StatusPill
                  label={launchReadiness.isEligible ? "eligible" : "ineligible"}
                  tone={scoreTone}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-muted/60">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-300",
                    launchReadiness.isEligible ? "bg-emerald-500" : "bg-amber-500",
                  )}
                  style={{ width: `${launchReadiness.score}%` }}
                />
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                {readinessSummary}
              </p>
            </div>
          </div>
        </div>

        <div className="paperclip-soft-divider my-5" />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="paperclip-panel px-4 py-3">
            <div className="paperclip-kicker">Wallets</div>
            <div className="mt-2 text-2xl font-semibold">{launch.walletOptions.length}</div>
          </div>
          <div className="paperclip-panel px-4 py-3">
            <div className="paperclip-kicker">Requests</div>
            <div className="mt-2 text-2xl font-semibold">{launch.requests.length}</div>
          </div>
          <div className="paperclip-panel px-4 py-3">
            <div className="paperclip-kicker">State</div>
            <div className="mt-2 text-lg font-semibold">
              {launch.deployedTokenAddress
                ? "Deployed"
                : launch.deploymentUnknownAt
                  ? "Locked"
                  : latestRequest
                    ? statusLabel(latestRequest.approvalStatus)
                    : "Draft"}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {companyLocked ? (
            <StatusPill
              label={launch.deployedTokenAddress ? "company locked after deploy" : "company locked pending review"}
              tone={launch.deployedTokenAddress ? "success" : "danger"}
            />
          ) : (
            <StatusPill label={isDirty ? "unsaved draft changes" : "draft synced"} tone={isDirty ? "warn" : "default"} />
          )}
          {!hasWalletOptions && <StatusPill label="no synced Base wallet" tone="danger" />}
          {simulation && !isDirty && <StatusPill label="fresh simulation ready" tone="success" />}
          {simulation && isDirty && <StatusPill label="simulation needs rerun" tone="warn" />}
        </div>

        {actionError && <p className="mt-4 text-sm text-destructive">{actionError}</p>}
      </section>

      {launch.deployedTokenAddress && (
        <section className="paperclip-panel p-5 sm:p-6 space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <h2 className="text-xl font-semibold">Token deployed</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                This company already has a live token. Additional submissions are now blocked.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {launch.claimFeesUrl && (
                <Button asChild>
                  <a href={launch.claimFeesUrl} target="_blank" rel="noreferrer">
                    Claim Fees
                    <ArrowUpRight className="ml-1 h-4 w-4" />
                  </a>
                </Button>
              )}
              <Button variant="outline" asChild>
                <a href={launch.claimFeesDocsUrl} target="_blank" rel="noreferrer">
                  Claim docs
                  <ArrowUpRight className="ml-1 h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="paperclip-panel px-4 py-3">
              <div className="paperclip-kicker">Token</div>
              <div className="mt-2 text-sm font-medium">{shortAddress(launch.deployedTokenAddress)}</div>
            </div>
            <div className="paperclip-panel px-4 py-3">
              <div className="paperclip-kicker">Pool</div>
              <div className="mt-2 text-sm font-medium">{launch.deployedPoolId ?? "—"}</div>
            </div>
            <div className="paperclip-panel px-4 py-3">
              <div className="paperclip-kicker">Transaction</div>
              <div className="mt-2 text-sm font-medium">{shortAddress(launch.deployedTxHash)}</div>
            </div>
            <div className="paperclip-panel px-4 py-3">
              <div className="paperclip-kicker">Chain</div>
              <div className="mt-2 text-sm font-medium">{launch.deployedChain ?? "base"}</div>
            </div>
          </div>

          <FeeDistributionList distribution={launch.deployedFeeDistribution} />
        </section>
      )}

      {launch.deploymentUnknownAt && !launch.deployedTokenAddress && (
        <section className="paperclip-panel p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-red-500" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Manual review required</h2>
              <p className="text-sm text-muted-foreground">
                Bankr did not return a definitive live deploy result on {formatDateTime(launch.deploymentUnknownAt)}.
                This company is locked until an operator verifies whether a token was created.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="paperclip-panel p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Company launch dossier</h2>
            <p className="text-sm text-muted-foreground">
              Give reviewers enough context to judge whether the company has earned a token launch.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Stage">
            <Input
              value={formState.stage}
              onChange={(event) => setFormState((current) => ({ ...current, stage: event.target.value }))}
              placeholder="Live product, profitable, growing"
              disabled={companyLocked}
            />
          </Field>
          <Field label="Company website">
            <Input
              value={formState.companyWebsiteUrl}
              onChange={(event) => setFormState((current) => ({ ...current, companyWebsiteUrl: event.target.value }))}
              placeholder="https://example.com"
              disabled={companyLocked}
            />
          </Field>
        </div>

        <Field label="Business summary">
          <Textarea
            value={formState.businessSummary}
            onChange={(event) => setFormState((current) => ({ ...current, businessSummary: event.target.value }))}
            placeholder="What does the company do, and for whom?"
            className="min-h-28"
            disabled={companyLocked}
          />
        </Field>

        <Field label="Traction summary">
          <Textarea
            value={formState.tractionSummary}
            onChange={(event) => setFormState((current) => ({ ...current, tractionSummary: event.target.value }))}
            placeholder="Users, revenue, retention, or other concrete traction."
            className="min-h-28"
            disabled={companyLocked}
          />
        </Field>

        <Field label="Why should this company launch a token?">
          <Textarea
            value={formState.launchRationale}
            onChange={(event) => setFormState((current) => ({ ...current, launchRationale: event.target.value }))}
            placeholder="Explain why a token improves the company rather than distracting from the business."
            className="min-h-32"
            disabled={companyLocked}
          />
        </Field>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="X profile">
            <Input
              value={formState.socialLinks.x}
              onChange={(event) => setFormState((current) => ({ ...current, socialLinks: { ...current.socialLinks, x: event.target.value } }))}
              placeholder="https://x.com/company"
              disabled={companyLocked}
            />
          </Field>
          <Field label="Farcaster profile">
            <Input
              value={formState.socialLinks.farcaster}
              onChange={(event) => setFormState((current) => ({ ...current, socialLinks: { ...current.socialLinks, farcaster: event.target.value } }))}
              placeholder="https://warpcast.com/company"
              disabled={companyLocked}
            />
          </Field>
          <Field label="Telegram">
            <Input
              value={formState.socialLinks.telegram}
              onChange={(event) => setFormState((current) => ({ ...current, socialLinks: { ...current.socialLinks, telegram: event.target.value } }))}
              placeholder="https://t.me/company"
              disabled={companyLocked}
            />
          </Field>
          <Field label="Discord">
            <Input
              value={formState.socialLinks.discord}
              onChange={(event) => setFormState((current) => ({ ...current, socialLinks: { ...current.socialLinks, discord: event.target.value } }))}
              placeholder="https://discord.gg/company"
              disabled={companyLocked}
            />
          </Field>
        </div>
      </section>

      <section className="paperclip-panel p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Token metadata</h2>
            <p className="text-sm text-muted-foreground">
              These fields are sent to Bankr for simulation and live deploy.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Token name">
            <Input
              value={formState.tokenName}
              onChange={(event) => setFormState((current) => ({ ...current, tokenName: event.target.value }))}
              placeholder="Juno Network"
              disabled={companyLocked}
            />
          </Field>
          <Field label="Token symbol">
            <Input
              value={formState.tokenSymbol}
              onChange={(event) => setFormState((current) => ({ ...current, tokenSymbol: event.target.value.toUpperCase() }))}
              placeholder="JUNO"
              maxLength={10}
              disabled={companyLocked}
            />
          </Field>
        </div>

        <Field label="Token description">
          <Textarea
            value={formState.tokenDescription}
            onChange={(event) => setFormState((current) => ({ ...current, tokenDescription: event.target.value }))}
            placeholder="Short public description shown on the launch."
            className="min-h-24"
            disabled={companyLocked}
          />
        </Field>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(240px,0.7fr)]">
          <Field label="Token image">
            <div className="space-y-3">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                onChange={handleTokenImageFileChange}
                disabled={companyLocked || imageUploadMutation.isPending}
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-xs"
              />
              <Input
                value={formState.imageUrl}
                onChange={(event) => setFormState((current) => ({ ...current, imageUrl: event.target.value }))}
                placeholder="https://... or upload a file above"
                disabled={companyLocked}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>PNG, JPEG, WEBP, GIF, or SVG.</span>
                {imageUploadMutation.isPending && <span>Uploading image...</span>}
              </div>
              {(imageUploadMutation.isError || imageUploadError) && (
                <p className="text-xs text-destructive">
                  {imageUploadError
                    ?? (imageUploadMutation.error instanceof Error
                      ? imageUploadMutation.error.message
                      : "Image upload failed")}
                </p>
              )}
              {formState.imageUrl && !companyLocked && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleClearTokenImage}
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    Remove image
                  </Button>
                </div>
              )}
            </div>
          </Field>

          <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="paperclip-kicker">Preview</div>
                <div className="mt-1 text-sm font-medium">Token artwork</div>
              </div>
              <Upload className="h-4 w-4 text-muted-foreground" />
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-background/70">
              {formState.imageUrl ? (
                <img
                  src={formState.imageUrl}
                  alt={formState.tokenName ? `${formState.tokenName} token artwork` : "Token artwork preview"}
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  Upload or paste an image URL to preview the token artwork here.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Tweet URL">
            <Input
              value={formState.tweetUrl}
              onChange={(event) => setFormState((current) => ({ ...current, tweetUrl: event.target.value }))}
              placeholder="https://x.com/..."
              disabled={companyLocked}
            />
          </Field>
          <Field label="Token website URL">
            <Input
              value={formState.tokenWebsiteUrl}
              onChange={(event) => setFormState((current) => ({ ...current, tokenWebsiteUrl: event.target.value }))}
              placeholder="https://token.company.com"
              disabled={companyLocked}
            />
          </Field>
        </div>
      </section>

      <section className="paperclip-panel p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Fee wallet and actions</h2>
            <p className="text-sm text-muted-foreground">
              V1 only supports a synced Base wallet as the creator fee recipient.
            </p>
          </div>
        </div>

        <Field label="Recipient wallet">
          <Select
            value={formState.selectedFeeWalletAddress || undefined}
            onValueChange={(value) => setFormState((current) => ({ ...current, selectedFeeWalletAddress: value }))}
            disabled={companyLocked || !hasWalletOptions}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={hasWalletOptions ? "Select a synced wallet" : "No synced Base wallets"} />
            </SelectTrigger>
            <SelectContent>
              {launch.walletOptions.map((wallet) => (
                <SelectItem key={wallet.address} value={wallet.address}>
                  {walletLabel(wallet)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {!hasWalletOptions && (
          <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            No synced Base wallet is available in the hosted session. Connect one through Privy before simulating or submitting.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => saveMutation.mutate({ draft: draftPayload })}
            disabled={companyLocked || saveMutation.isPending || busy}
          >
            {saveMutation.isPending ? "Saving..." : "Save draft"}
          </Button>
          <Button
            variant="outline"
            onClick={() => simulateMutation.mutate()}
            disabled={companyLocked || !hasWalletOptions || simulateMutation.isPending || submitMutation.isPending || saveMutation.isPending || busy}
          >
            <FlaskConical className="mr-2 h-4 w-4" />
            {simulateMutation.isPending ? "Simulating..." : "Simulate"}
          </Button>
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={companyLocked || !hasWalletOptions || submitMutation.isPending || simulateMutation.isPending || saveMutation.isPending || busy}
          >
            {submitMutation.isPending ? "Submitting..." : "Submit for review"}
          </Button>
        </div>
      </section>

      <section className="paperclip-panel p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Latest simulation</h2>
            <p className="text-sm text-muted-foreground">
              {simulation ? formatDateTime(simulation.simulatedAt) : "Run Bankr simulateOnly before submitting."}
            </p>
          </div>
          {simulation ? (
            <Badge variant={isDirty ? "outline" : "secondary"}>
              {isDirty ? "Needs rerun" : "Current"}
            </Badge>
          ) : null}
        </div>

        {simulation ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Token address</div>
                <div className="mt-1 text-sm font-medium">{shortAddress(simulation.result.tokenAddress)}</div>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Pool</div>
                <div className="mt-1 text-sm font-medium">{simulation.result.poolId}</div>
              </div>
            </div>
            <FeeDistributionList distribution={simulation.result.feeDistribution ?? null} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No simulation stored yet. Save the draft, choose a synced Base wallet, and simulate the current payload.
          </p>
        )}
      </section>

      <section className="paperclip-panel p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Request and deploy history</h2>
          <p className="text-sm text-muted-foreground">
            Every submission creates a new immutable request linked into the compliance queue.
          </p>
        </div>

        {launch.requests.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
            No submissions yet. Run a fresh simulation, then submit the current draft for review.
          </div>
        ) : (
          <div className="space-y-3">
            {launch.requests.map((request) => {
              const canConfirm =
                currentUserId !== null
                && request.submittedByUserId === currentUserId
                && request.approvalStatus === "approved"
                && request.deployStatus === "not_started"
                && !launch.deployedTokenAddress
                && !launch.deploymentUnknownAt;

              return (
                <RequestRow
                  key={request.id}
                  request={request}
                  canConfirm={canConfirm}
                  isConfirming={confirmMutation.isPending && confirmMutation.variables === request.id}
                  onConfirm={() => confirmMutation.mutate(request.id)}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
