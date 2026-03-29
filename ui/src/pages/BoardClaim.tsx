import { useMemo } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "@/lib/router";
import { accessApi } from "../api/access";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, AlertTriangle, LockKeyhole } from "lucide-react";

export function BoardClaimPage() {
  const queryClient = useQueryClient();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const token = (params.token ?? "").trim();
  const code = (searchParams.get("code") ?? "").trim();
  const currentPath = useMemo(
    () => `/board-claim/${encodeURIComponent(token)}${code ? `?code=${encodeURIComponent(code)}` : ""}`,
    [token, code],
  );

  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const statusQuery = useQuery({
    queryKey: ["board-claim", token, code],
    queryFn: () => accessApi.getBoardClaimStatus(token, code),
    enabled: token.length > 0 && code.length > 0,
    retry: false,
  });

  const frame = (title: string, description: string, body: ReactNode) => (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.1),_transparent_32%),radial-gradient(circle_at_70%_18%,_rgba(255,255,255,0.05),_transparent_22%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mb-4 flex items-center justify-between gap-4 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
          <span>System consent / board claim</span>
          <Badge variant="outline" className="border-border/70 bg-background/50 text-[10px] uppercase tracking-[0.24em]">
            Claim flow
          </Badge>
        </div>
        <div className="paperclip-panel paperclip-panel-strong flex flex-1 flex-col justify-between rounded-[28px] p-5 sm:p-7 lg:p-8">
          <div className="space-y-6">
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span>Trusted ownership transfer</span>
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

  const claimMutation = useMutation({
    mutationFn: () => accessApi.claimBoard(token, code),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await queryClient.invalidateQueries({ queryKey: queryKeys.health });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.companies.stats });
      await statusQuery.refetch();
    },
  });

  if (!token || !code) {
    return frame(
      "Invalid board claim URL",
      "The claim token or code is missing from the route.",
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Double-check the link that was used to open this page.
      </div>,
    );
  }

  if (statusQuery.isLoading || sessionQuery.isLoading) {
    return frame(
      "Loading claim challenge",
      "We are checking the board claim challenge and your current session.",
      <div className="paperclip-panel rounded-[22px] px-4 py-3 text-sm text-muted-foreground">
        Loading claim challenge…
      </div>,
    );
  }

  if (statusQuery.error) {
    return frame(
      "Claim challenge unavailable",
      "The ownership transfer request could not be loaded.",
      <div className="paperclip-panel rounded-[24px] border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <p className="text-sm text-muted-foreground">
            {statusQuery.error instanceof Error ? statusQuery.error.message : "Challenge is invalid or expired."}
          </p>
        </div>
      </div>,
    );
  }

  const status = statusQuery.data;
  if (!status) {
    return frame(
      "Claim challenge unavailable",
      "The board claim state is missing or could not be interpreted.",
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Claim challenge unavailable.
      </div>,
    );
  }

  if (status.status === "claimed") {
    return frame(
      "Board ownership claimed",
      "The instance is now linked to your authenticated user.",
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
        <div className="paperclip-panel rounded-[24px] p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Ownership transfer complete
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This board is now attached to your account and ready for normal use.
          </p>
        </div>
        <Button asChild className="h-11 rounded-xl">
          <Link to="/">Open board</Link>
        </Button>
      </div>,
    );
  }

  if (!sessionQuery.data) {
    return frame(
      "Sign in required",
      "Authenticate before transferring ownership of the board.",
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
        <div className="paperclip-panel rounded-[24px] p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LockKeyhole className="h-4 w-4 text-emerald-400" />
            Session required
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign in or create an account, then return to this page to claim board ownership.
          </p>
        </div>
        <Button asChild className="h-11 rounded-xl">
          <Link to={`/auth?next=${encodeURIComponent(currentPath)}`}>Sign in / Create account</Link>
        </Button>
      </div>,
    );
  }

  return frame(
    "Claim board ownership",
    "This promotes your user to instance admin and migrates company ownership access from local trusted mode.",
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
      <div className="paperclip-panel rounded-[24px] p-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          Claim ready
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Confirm the transfer to make this authenticated user the board owner.
        </p>

        <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2">
            <div className="uppercase tracking-[0.22em]">Token</div>
            <div className="mt-1 font-mono text-foreground break-all">{token}</div>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2">
            <div className="uppercase tracking-[0.22em]">Code</div>
            <div className="mt-1 font-mono text-foreground break-all">{code}</div>
          </div>
        </div>

        {claimMutation.error && (
          <p className="mt-4 text-sm text-destructive">
            {claimMutation.error instanceof Error ? claimMutation.error.message : "Failed to claim board ownership"}
          </p>
        )}
      </div>
      <Button
        className="h-11 rounded-xl"
        onClick={() => claimMutation.mutate()}
        disabled={claimMutation.isPending}
      >
        {claimMutation.isPending ? "Claiming…" : "Claim ownership"}
      </Button>
    </div>,
  );
}
