import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { goalsApi } from "../api/goals";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { GoalTree } from "../components/GoalTree";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Target, Plus } from "lucide-react";

export function Goals() {
  const { selectedCompanyId } = useCompany();
  const { openNewGoal } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Goals" }]);
  }, [setBreadcrumbs]);

  const { data: goals, isLoading, error } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const totalGoals = goals?.length ?? 0;
  const rootGoals = (goals ?? []).filter((goal) => !goal.parentId).length;
  const childGoals = totalGoals - rootGoals;

  if (!selectedCompanyId) {
    return <EmptyState icon={Target} message="Select a company to view goals." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-5">
      <section className="paperclip-panel paperclip-panel-strong command-fade-up p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="paperclip-kicker">Objective index</p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Goals</h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Layer outcomes, owners, and sub-goals in one tree without losing the top-level scan.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-2 border border-border/60 bg-background/30 px-2.5 py-1 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{totalGoals}</span>
                total
              </span>
              <span className="inline-flex items-center gap-2 border border-border/60 bg-background/30 px-2.5 py-1 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{rootGoals}</span>
                roots
              </span>
              <span className="inline-flex items-center gap-2 border border-border/60 bg-background/30 px-2.5 py-1 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{childGoals}</span>
                children
              </span>
            </div>
          </div>

          <div className="flex items-center justify-start">
            <Button size="sm" variant="outline" onClick={() => openNewGoal()}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New Goal
            </Button>
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {goals && goals.length === 0 && (
        <EmptyState
          icon={Target}
          message="No goals yet."
          action="Add Goal"
          onAction={() => openNewGoal()}
        />
      )}

      {goals && goals.length > 0 && (
        <div className="paperclip-panel command-fade-up">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <div>
              <p className="paperclip-kicker">Working surface</p>
              <p className="text-sm text-muted-foreground">Goal tree</p>
            </div>
            <p className="text-xs text-muted-foreground">{rootGoals} roots</p>
          </div>
          <GoalTree goals={goals} goalLink={(goal) => `/goals/${goal.id}`} />
        </div>
      )}
    </div>
  );
}
