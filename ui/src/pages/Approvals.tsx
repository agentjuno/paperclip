import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { PageTabBar } from "../components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { ShieldCheck } from "lucide-react";
import { ApprovalCard } from "../components/ApprovalCard";
import { PageSkeleton } from "../components/PageSkeleton";

type StatusFilter = "pending" | "all";

export function Approvals() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const pathSegment = location.pathname.split("/").pop() ?? "pending";
  const statusFilter: StatusFilter = pathSegment === "all" ? "all" : "pending";
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Approvals" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.approve(id),
    onSuccess: (_approval, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(`/approvals/${id}?resolved=approved`);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.reject(id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject");
    },
  });

  const filtered = (data ?? [])
    .filter(
      (a) => statusFilter === "all" || a.status === "pending" || a.status === "revision_requested",
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pendingCount = (data ?? []).filter(
    (a) => a.status === "pending" || a.status === "revision_requested",
  ).length;
  const totalCount = data?.length ?? 0;
  const revisionCount = useMemo(
    () => (data ?? []).filter((approval) => approval.status === "revision_requested").length,
    [data],
  );

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }

  if (isLoading) {
    return <PageSkeleton variant="approvals" />;
  }

  return (
    <div className="space-y-5">
      <section className="paperclip-panel paperclip-panel-strong command-fade-up p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="paperclip-kicker">Decision queue</p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Approvals</h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Review pending decisions, requested revisions, and historical outcomes from one queue.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-2 border border-border/60 bg-background/30 px-2.5 py-1 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{pendingCount}</span>
                pending
              </span>
              <span className="inline-flex items-center gap-2 border border-border/60 bg-background/30 px-2.5 py-1 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{revisionCount}</span>
                revisions
              </span>
              <span className="inline-flex items-center gap-2 border border-border/60 bg-background/30 px-2.5 py-1 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{totalCount}</span>
                total
              </span>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Approve, reject, or open detail without losing queue context.
          </div>
        </div>

        <div className="paperclip-soft-divider my-5" />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={statusFilter} onValueChange={(v) => navigate(`/approvals/${v}`)}>
            <PageTabBar
              items={[
                {
                  value: "pending",
                  label: (
                    <>
                      Pending
                      {pendingCount > 0 && (
                        <span
                          className={cn(
                            "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            "bg-yellow-500/20 text-yellow-500"
                          )}
                        >
                          {pendingCount}
                        </span>
                      )}
                    </>
                  ),
                },
                { value: "all", label: "All" },
              ]}
            />
          </Tabs>

          <p className="text-xs text-muted-foreground">
            {statusFilter === "pending" ? "Pending queue only." : "All approvals, including resolved items."}
          </p>
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {filtered.length === 0 && (
        <div className="paperclip-panel flex flex-col items-center justify-center py-16 text-center">
          <ShieldCheck className="mb-3 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {statusFilter === "pending" ? "No pending approvals." : "No approvals yet."}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="paperclip-panel p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <p className="paperclip-kicker">Working surface</p>
              <p className="text-sm text-muted-foreground">{filtered.length} visible approval{filtered.length !== 1 ? "s" : ""}</p>
            </div>
            <p className="text-xs text-muted-foreground">Resolve from queue or detail</p>
          </div>
          <div className="grid gap-3">
          {filtered.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              requesterAgent={approval.requestedByAgentId ? (agents ?? []).find((a) => a.id === approval.requestedByAgentId) ?? null : null}
              onApprove={() => approveMutation.mutate(approval.id)}
              onReject={() => rejectMutation.mutate(approval.id)}
              detailLink={`/approvals/${approval.id}`}
              isPending={approveMutation.isPending || rejectMutation.isPending}
            />
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
