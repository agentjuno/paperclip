import { useMemo } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { accessApi } from "../api/access";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { AlertTriangle, ShieldCheck, LockKeyhole } from "lucide-react";

export function CliAuthPage() {
  const queryClient = useQueryClient();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const challengeId = (params.id ?? "").trim();
  const token = (searchParams.get("token") ?? "").trim();
  const currentPath = useMemo(
    () => `/cli-auth/${encodeURIComponent(challengeId)}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    [challengeId, token],
  );

  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const challengeQuery = useQuery({
    queryKey: ["cli-auth-challenge", challengeId, token],
    queryFn: () => accessApi.getCliAuthChallenge(challengeId, token),
    enabled: challengeId.length > 0 && token.length > 0,
    retry: false,
  });

  const approveMutation = useMutation({
    mutationFn: () => accessApi.approveCliAuthChallenge(challengeId, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await challengeQuery.refetch();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => accessApi.cancelCliAuthChallenge(challengeId, token),
    onSuccess: async () => {
      await challengeQuery.refetch();
    },
  });

  const frame = (title: string, description: string, body: ReactNode) => (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.1),_transparent_32%),radial-gradient(circle_at_75%_16%,_rgba(255,255,255,0.05),_transparent_24%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mb-4 flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
          <span>System consent / CLI auth</span>
          <Badge variant="outline" className="border-border/70 bg-background/50 text-[10px] uppercase tracking-[0.24em]">
            CLI access
          </Badge>
        </div>
        <div className="paperclip-panel paperclip-panel-strong flex flex-1 flex-col justify-between rounded-[28px] p-5 sm:p-7 lg:p-8">
          <div className="space-y-6">
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span>Request approval gate</span>
              </div>
              <div className="space-y-2">
                <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
                <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            </div>
            {body}
          </div>
        </div>
      </div>
    </div>
  );

  if (!challengeId || !token) {
    return frame(
      "Invalid CLI auth URL",
      "The challenge id or token is missing from the route.",
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Double-check the link that was used to open this page.
      </div>,
    );
  }

  if (sessionQuery.isLoading || challengeQuery.isLoading) {
    return frame(
      "Loading CLI auth challenge",
      "We are checking the request and your current session.",
      <div className="paperclip-panel rounded-[22px] px-4 py-3 text-sm text-muted-foreground">
        Loading CLI auth challenge…
      </div>,
    );
  }

  if (challengeQuery.error) {
    return frame(
      "CLI auth challenge unavailable",
      "The approval request could not be loaded.",
      <div className="paperclip-panel rounded-[24px] border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <p className="text-sm text-muted-foreground">
            {challengeQuery.error instanceof Error ? challengeQuery.error.message : "Challenge is invalid or expired."}
          </p>
        </div>
      </div>,
    );
  }

  const challenge = challengeQuery.data;
  if (!challenge) {
    return frame(
      "CLI auth challenge unavailable",
      "The approval request is missing or could not be interpreted.",
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        CLI auth challenge unavailable.
      </div>,
    );
  }

  if (challenge.status === "approved") {
    return frame(
      "CLI access approved",
      "The Paperclip CLI can finish authentication on the requesting machine.",
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
        <div className="paperclip-panel rounded-[24px] p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Approval recorded
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The requesting CLI can now complete the login handshake.
          </p>
          <div className="mt-4 rounded-xl border border-border/70 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
            <div className="uppercase tracking-[0.22em]">Command</div>
            <div className="mt-1 font-mono break-all text-foreground">{challenge.command}</div>
          </div>
        </div>
        <Button asChild className="h-11 rounded-xl">
          <Link to="/">Return to board</Link>
        </Button>
      </div>,
    );
  }

  if (challenge.status === "cancelled" || challenge.status === "expired") {
    return frame(
      challenge.status === "expired" ? "CLI auth challenge expired" : "CLI auth challenge cancelled",
      "Start the CLI auth flow again from your terminal to generate a new approval request.",
      <div className="paperclip-panel rounded-[24px] p-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <LockKeyhole className="h-4 w-4 text-emerald-400" />
          Request closed
        </div>
      </div>,
    );
  }

  if (challenge.requiresSignIn || !sessionQuery.data) {
    return frame(
      "Sign in required",
      "Authenticate before approving the CLI access request.",
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
        <div className="paperclip-panel rounded-[24px] p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LockKeyhole className="h-4 w-4 text-emerald-400" />
            Session required
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign in or create an account, then return to this page to approve the CLI access request.
          </p>
        </div>
        <Button asChild className="h-11 rounded-xl">
          <Link to={`/auth?next=${encodeURIComponent(currentPath)}`}>Sign in / Create account</Link>
        </Button>
      </div>,
    );
  }

  return frame(
    "Approve Paperclip CLI access",
    "A local Paperclip CLI process is requesting board access to this instance.",
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="paperclip-panel rounded-[24px] p-5">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2">
            <div className="uppercase tracking-[0.22em] text-muted-foreground">Command</div>
            <div className="mt-1 font-mono text-foreground break-all">{challenge.command}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2">
            <div className="uppercase tracking-[0.22em] text-muted-foreground">Client</div>
            <div className="mt-1 text-foreground">{challenge.clientName ?? "paperclipai cli"}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2">
            <div className="uppercase tracking-[0.22em] text-muted-foreground">Requested access</div>
            <div className="mt-1 text-foreground">
              {challenge.requestedAccess === "instance_admin_required" ? "Instance admin" : "Board"}
            </div>
          </div>
          {challenge.requestedCompanyName && (
            <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2">
              <div className="uppercase tracking-[0.22em] text-muted-foreground">Requested company</div>
              <div className="mt-1 text-foreground">{challenge.requestedCompanyName}</div>
            </div>
          )}
        </div>

        {(approveMutation.error || cancelMutation.error) && (
          <p className="mt-4 text-sm text-destructive">
            {(approveMutation.error ?? cancelMutation.error) instanceof Error
              ? ((approveMutation.error ?? cancelMutation.error) as Error).message
              : "Failed to update CLI auth challenge"}
          </p>
        )}

        {!challenge.canApprove && (
          <p className="mt-4 text-sm text-destructive">
            This challenge requires instance-admin access. Sign in with an instance admin account to approve it.
          </p>
        )}
      </div>
      <div className="space-y-3">
        <Button
          className="h-11 w-full rounded-xl"
          onClick={() => approveMutation.mutate()}
          disabled={!challenge.canApprove || approveMutation.isPending || cancelMutation.isPending}
        >
          {approveMutation.isPending ? "Approving..." : "Approve CLI access"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full rounded-xl"
          onClick={() => cancelMutation.mutate()}
          disabled={approveMutation.isPending || cancelMutation.isPending}
        >
          {cancelMutation.isPending ? "Cancelling..." : "Cancel"}
        </Button>
      </div>
    </div>,
  );
}
