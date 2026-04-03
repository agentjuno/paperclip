import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CreditCard,
  ExternalLink,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { billingApi } from "../api/billing";
import type { BillingUsageRow } from "@paperclipai/shared";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatCents, formatTokens } from "../lib/utils";

/* ── Helpers ── */

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

function formatPeriod(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  return `${new Date(from).toLocaleDateString(undefined, opts)} – ${new Date(to).toLocaleDateString(undefined, opts)}`;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
  incomplete_expired: "Expired",
  paused: "Paused",
  none: "No subscription",
};

const STATUS_COLORS: Record<string, string> = {
  active:
    "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  trialing:
    "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  past_due:
    "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  canceled: "bg-muted text-muted-foreground",
  none: "bg-muted text-muted-foreground",
};

const STATUS_COLORS_DEFAULT = "bg-muted text-muted-foreground";

/* ── Subscription Status Badge ── */

function SubscriptionStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] whitespace-nowrap",
        STATUS_COLORS[status] ?? STATUS_COLORS_DEFAULT,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/* ── Loading Skeleton ── */

function BillingSkeleton() {
  return (
    <div className="space-y-6" data-testid="billing-loading">
      <div className="flex items-center gap-3">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-6 w-20" />
      </div>
      <Skeleton className="h-40 w-full rounded-[24px] bg-card/70" />
      <Skeleton className="h-60 w-full rounded-[24px] bg-card/70" />
    </div>
  );
}

/* ── Error State ── */

function BillingError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center"
      data-testid="billing-error"
    >
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <div>
        <h3 className="text-sm font-medium text-destructive">Failed to load billing</h3>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      )}
    </div>
  );
}

/* ── No Subscription State ── */

function NoSubscription({ onSubscribe, isLoading }: { onSubscribe: () => void; isLoading: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border p-8 text-center"
      data-testid="billing-no-subscription"
    >
      <CreditCard className="h-10 w-10 text-muted-foreground" />
      <div>
        <h3 className="text-sm font-medium">No active subscription</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Subscribe to a billing plan to enable usage-based billing for your AI agent token
          consumption.
        </p>
      </div>
      <Button size="sm" onClick={onSubscribe} disabled={isLoading} data-testid="billing-subscribe-btn">
        {isLoading ? (
          <>
            <Loader2 className="animate-spin mr-2 h-4 w-4" />
            Redirecting…
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" />
            Subscribe
          </>
        )}
      </Button>
    </div>
  );
}

/* ── Usage Row ── */

function UsageModelRow({ row }: { row: BillingUsageRow }) {
  const totalTokens = row.inputTokens + row.outputTokens + row.cachedInputTokens;
  return (
    <div className="flex items-start justify-between gap-3 border border-border/80 px-4 py-3 transition-colors hover:bg-accent/20">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {row.provider}
          <span className="mx-1 text-border">/</span>
          <span className="font-mono">{row.model}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          in {formatTokens(row.inputTokens + row.cachedInputTokens)} · out{" "}
          {formatTokens(row.outputTokens)}
        </div>
      </div>
      <div className="text-right text-sm tabular-nums">
        <div className="font-medium">{formatCents(row.costCents)}</div>
        <div className="text-xs text-muted-foreground">{formatTokens(totalTokens)} tokens</div>
      </div>
    </div>
  );
}

/* ── Main BillingTab ── */

export function BillingTab() {
  const { pushToast } = useToast();

  const monthRange = useMemo(() => currentMonthRange(), []);

  /* ── Subscription status query ── */
  const {
    data: subscriptionData,
    isLoading: subLoading,
    error: subError,
    refetch: refetchSub,
  } = useQuery({
    queryKey: queryKeys.billing.subscriptionStatus,
    queryFn: billingApi.getSubscriptionStatus,
  });

  /* ── Usage query (user-level aggregated, current month) ── */
  const {
    data: usageData,
    isLoading: usageLoading,
    error: usageError,
  } = useQuery({
    queryKey: queryKeys.billing.aggregatedUsage(monthRange.from, monthRange.to),
    queryFn: () =>
      billingApi.getAggregatedUsage(monthRange.from, monthRange.to),
  });

  /* ── Mutations ── */
  const checkoutMutation = useMutation({
    mutationFn: billingApi.createCheckoutSession,
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      pushToast({ title: "Checkout failed", body: err.message, tone: "error" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: billingApi.createPortalSession,
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to open portal", body: err.message, tone: "error" });
    },
  });

  /* ── Loading ── */
  if (subLoading) {
    return <BillingSkeleton />;
  }

  /* ── Error ── */
  if (subError) {
    return (
      <BillingError
        message={(subError as Error).message}
        onRetry={() => refetchSub()}
      />
    );
  }

  const status = subscriptionData?.status ?? "none";
  const isActive = status === "active" || status === "trialing";

  /* ── No subscription ── */
  if (!isActive) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Billing</h2>
          <SubscriptionStatusBadge status={status} />
        </div>
        <NoSubscription
          onSubscribe={() => checkoutMutation.mutate()}
          isLoading={checkoutMutation.isPending}
        />
      </div>
    );
  }

  /* ── Active subscription ── */
  const usageRows = usageData?.rows ?? [];
  const sortedRows = [...usageRows].sort((a, b) => b.costCents - a.costCents);

  return (
    <div className="space-y-6" data-testid="billing-active">
      {/* Subscription info */}
      <Card className="paperclip-panel">
        <CardHeader className="px-5 pt-5 pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">Subscription</CardTitle>
              <SubscriptionStatusBadge status={status} />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              data-testid="billing-manage-btn"
            >
              {portalMutation.isPending ? (
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
              ) : (
                <ExternalLink className="mr-2 h-4 w-4" />
              )}
              Manage Subscription
            </Button>
          </div>
          <CardDescription>
            LLM token billing plan · Usage-based pricing
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-5 pt-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Billing period
              </div>
              <div className="mt-1 text-sm font-medium">
                {formatPeriod(monthRange.from, monthRange.to)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Estimated cost
              </div>
              <div className="mt-1 text-sm font-medium tabular-nums" data-testid="billing-estimated-cost">
                {usageLoading ? (
                  <Skeleton className="h-5 w-16 inline-block" />
                ) : usageError ? (
                  <span className="text-destructive">—</span>
                ) : (
                  formatCents(usageData?.totalCostCents ?? 0)
                )}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  (estimated)
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage breakdown */}
      <Card className="paperclip-panel">
        <CardHeader className="px-5 pt-5 pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Usage this period</CardTitle>
              <CardDescription>
                Per-model token consumption for the current billing period.
              </CardDescription>
            </div>
            {!usageLoading && usageData && (
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums">
                  {formatTokens(usageData.totalTokens)}
                </div>
                <div className="text-xs text-muted-foreground">total tokens</div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 px-5 pb-5 pt-2" data-testid="billing-usage-section">
          {usageLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="animate-spin mr-2 size-4" />
              Loading usage…
            </div>
          ) : usageError ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
              {(usageError as Error).message}
            </div>
          ) : sortedRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <Zap className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No usage recorded this period.
              </p>
            </div>
          ) : (
            sortedRows.map((row) => (
              <UsageModelRow
                key={`${row.provider}:${row.model}`}
                row={row}
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
