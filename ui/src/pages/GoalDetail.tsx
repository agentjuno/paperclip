import { useEffect } from "react";
import { useParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { goalsApi } from "../api/goals";
import { projectsApi } from "../api/projects";
import { assetsApi } from "../api/assets";
import { usePanel } from "../context/PanelContext";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { GoalProperties } from "../components/GoalProperties";
import { GoalTree } from "../components/GoalTree";
import { StatusBadge } from "../components/StatusBadge";
import { InlineEditor } from "../components/InlineEditor";
import { EntityRow } from "../components/EntityRow";
import { PageSkeleton } from "../components/PageSkeleton";
import { projectUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import type { Goal, Project } from "@paperclipai/shared";

export function GoalDetail() {
  const { goalId } = useParams<{ goalId: string }>();
  const { selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { openNewGoal } = useDialog();
  const { openPanel, closePanel } = usePanel();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const {
    data: goal,
    isLoading,
    error
  } = useQuery({
    queryKey: queryKeys.goals.detail(goalId!),
    queryFn: () => goalsApi.get(goalId!),
    enabled: !!goalId
  });
  const resolvedCompanyId = goal?.companyId ?? selectedCompanyId;

  const { data: allGoals } = useQuery({
    queryKey: queryKeys.goals.list(resolvedCompanyId!),
    queryFn: () => goalsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId
  });

  const { data: allProjects } = useQuery({
    queryKey: queryKeys.projects.list(resolvedCompanyId!),
    queryFn: () => projectsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId
  });

  useEffect(() => {
    if (!goal?.companyId || goal.companyId === selectedCompanyId) return;
    setSelectedCompanyId(goal.companyId, { source: "route_sync" });
  }, [goal?.companyId, selectedCompanyId, setSelectedCompanyId]);

  const updateGoal = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      goalsApi.update(goalId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId!)
      });
      if (resolvedCompanyId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.goals.list(resolvedCompanyId)
        });
      }
    }
  });

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      if (!resolvedCompanyId) throw new Error("No company selected");
      return assetsApi.uploadImage(
        resolvedCompanyId,
        file,
        `goals/${goalId ?? "draft"}`
      );
    }
  });

  const childGoals = (allGoals ?? []).filter((g) => g.parentId === goalId);
  const linkedProjects = (allProjects ?? []).filter((p) => {
    if (!goalId) return false;
    if (p.goalIds.includes(goalId)) return true;
    if (p.goals.some((goalRef) => goalRef.id === goalId)) return true;
    return p.goalId === goalId;
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Goals", href: "/goals" },
      { label: goal?.title ?? goalId ?? "Goal" }
    ]);
  }, [setBreadcrumbs, goal, goalId]);

  useEffect(() => {
    if (goal) {
      openPanel(
        <GoalProperties
          goal={goal}
          onUpdate={(data) => updateGoal.mutate(data)}
        />
      );
    }
    return () => closePanel();
  }, [goal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!goal) return null;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border/70 bg-background/35 p-5 sm:p-6 shadow-[0_24px_80px_rgba(0,0,0,0.2)] backdrop-blur-sm space-y-5">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            <span>{goal.level}</span>
            <span className="h-1 w-1 rounded-full bg-emerald-400/80" />
            <StatusBadge status={goal.status} />
          </div>

          <InlineEditor
            value={goal.title}
            onSave={(title) => updateGoal.mutate({ title })}
            as="h2"
            className="text-2xl font-semibold tracking-tight sm:text-[2rem]"
          />

          <InlineEditor
            value={goal.description ?? ""}
            onSave={(description) => updateGoal.mutate({ description })}
            as="p"
            className="max-w-3xl text-sm text-muted-foreground sm:text-[15px] sm:leading-7"
            placeholder="Add a description..."
            multiline
            imageUploadHandler={async (file) => {
              const asset = await uploadImage.mutateAsync(file);
              return asset.contentPath;
            }}
          />
        </div>
      </section>

      <section className="rounded-3xl border border-border/70 bg-background/35 backdrop-blur-sm overflow-hidden">
        <div className="border-b border-border/70 px-4 py-3 sm:px-5">
          <Tabs defaultValue="children">
            <TabsList className="w-full justify-start gap-1">
              <TabsTrigger value="children">
                Sub-Goals ({childGoals.length})
              </TabsTrigger>
              <TabsTrigger value="projects">
                Projects ({linkedProjects.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="children" className="mt-5 space-y-4 px-0">
              <div className="flex items-center justify-start">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openNewGoal({ parentId: goalId })}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Sub Goal
                </Button>
              </div>
              {childGoals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sub-goals.</p>
              ) : (
                <GoalTree goals={childGoals} goalLink={(g) => `/goals/${g.id}`} />
              )}
            </TabsContent>

            <TabsContent value="projects" className="mt-5 px-0">
              {linkedProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No linked projects.</p>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border/70">
                  {linkedProjects.map((project) => (
                    <EntityRow
                      key={project.id}
                      title={project.name}
                      subtitle={project.description ?? undefined}
                      to={projectUrl(project)}
                      trailing={<StatusBadge status={project.status} />}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </section>
    </div>
  );
}
