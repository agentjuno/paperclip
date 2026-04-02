import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EntityRow } from "../components/EntityRow";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { formatDate, projectUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Hexagon, Plus } from "lucide-react";

export function Projects() {
  const { selectedCompanyId } = useCompany();
  const { openNewProject } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Projects" }]);
  }, [setBreadcrumbs]);

  const { data: allProjects, isLoading, error } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const projects = useMemo(
    () => (allProjects ?? []).filter((p) => !p.archivedAt),
    [allProjects],
  );
  const archivedProjects = (allProjects ?? []).filter((project) => !!project.archivedAt).length;
  const datedProjects = (allProjects ?? []).filter((project) => !!project.targetDate).length;

  if (!selectedCompanyId) {
    return <EmptyState icon={Hexagon} message="Select a company to view projects." />;
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
              <p className="paperclip-kicker">Delivery index</p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Projects</h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                Track active work, target dates, and archived delivery surfaces in one line.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-2 border border-border/60 bg-background/30 px-2.5 py-1 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{projects.length}</span>
                active
              </span>
              <span className="inline-flex items-center gap-2 border border-border/60 bg-background/30 px-2.5 py-1 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{datedProjects}</span>
                dated
              </span>
              <span className="inline-flex items-center gap-2 border border-border/60 bg-background/30 px-2.5 py-1 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{archivedProjects}</span>
                archived
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end">
          <Button size="sm" variant="outline" onClick={openNewProject}>
            <Plus className="h-4 w-4 mr-1" />
            Add Project
          </Button>
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {!isLoading && projects.length === 0 && (
        <EmptyState
          icon={Hexagon}
          message="No projects yet."
          action="Add Project"
          onAction={openNewProject}
        />
      )}

      {projects.length > 0 && (
        <div className="paperclip-panel">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <div>
              <p className="paperclip-kicker">Working surface</p>
              <p className="text-sm text-muted-foreground">Project list</p>
            </div>
            <p className="text-xs text-muted-foreground">{projects.length} visible</p>
          </div>
          {projects.map((project) => (
            <EntityRow
              key={project.id}
              title={project.name}
              subtitle={project.description ?? undefined}
              to={projectUrl(project)}
              trailing={
                <div className="flex items-center gap-3">
                  {project.targetDate && (
                    <span className="text-xs text-muted-foreground">
                      {formatDate(project.targetDate)}
                    </span>
                  )}
                  <StatusBadge status={project.status} />
                </div>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
