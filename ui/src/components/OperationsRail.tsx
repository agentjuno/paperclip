import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, CircleDot, FolderKanban, Radar } from "lucide-react";
import type { Agent, Issue, Project } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { activityApi } from "../api/activity";
import { agentsApi } from "../api/agents";
import { dashboardApi } from "../api/dashboard";
import { goalsApi } from "../api/goals";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { cn, issueUrl, projectUrl, relativeTime } from "../lib/utils";
import { ActivityRow } from "./ActivityRow";

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function statText(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

export function OperationsRail({ companyId }: { companyId: string | null | undefined }) {
  const { data: summary } = useQuery({
    queryKey: queryKeys.dashboard(companyId!),
    queryFn: () => dashboardApi.summary(companyId!),
    enabled: !!companyId,
    refetchInterval: 20_000,
  });
  const { data: activity } = useQuery({
    queryKey: queryKeys.activity(companyId!),
    queryFn: () => activityApi.list(companyId!),
    enabled: !!companyId,
    refetchInterval: 15_000,
  });
  const { data: liveRuns } = useQuery({
    queryKey: [...queryKeys.liveRuns(companyId!), "operations-rail"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId!),
    enabled: !!companyId,
    refetchInterval: 8_000,
  });
  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(companyId!),
    queryFn: () => issuesApi.list(companyId!),
    enabled: !!companyId,
  });
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId!),
    queryFn: () => agentsApi.list(companyId!),
    enabled: !!companyId,
  });
  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(companyId!),
    queryFn: () => projectsApi.list(companyId!),
    enabled: !!companyId,
  });
  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(companyId!),
    queryFn: () => goalsApi.list(companyId!),
    enabled: !!companyId,
  });

  const visibleProjects = useMemo(
    () => (projects ?? []).filter((project) => !project.archivedAt),
    [projects],
  );
  const issueMap = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues ?? []) {
      map.set(issue.id, issue);
    }
    return map;
  }, [issues]);
  const projectMap = useMemo(() => {
    const map = new Map<string, Project>();
    for (const project of visibleProjects) {
      map.set(project.id, project);
    }
    return map;
  }, [visibleProjects]);
  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents ?? []) {
      map.set(agent.id, agent);
    }
    return map;
  }, [agents]);
  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues ?? []) {
      map.set(`issue:${issue.id}`, issue.identifier ?? issue.id.slice(0, 8));
    }
    for (const agent of agents ?? []) {
      map.set(`agent:${agent.id}`, agent.name);
    }
    for (const project of visibleProjects) {
      map.set(`project:${project.id}`, project.name);
    }
    for (const goal of goals ?? []) {
      map.set(`goal:${goal.id}`, goal.title);
    }
    return map;
  }, [issues, agents, visibleProjects, goals]);
  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues ?? []) {
      map.set(`issue:${issue.id}`, issue.title);
    }
    return map;
  }, [issues]);
  const recentProjects = useMemo(
    () =>
      [...visibleProjects]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 4),
    [visibleProjects],
  );
  const activeRuns = liveRuns ?? [];
  const events = (activity ?? []).slice(0, 6);

  if (!companyId) return null;

  return (
    <aside className="hidden w-[18rem] shrink-0 border-l border-border/70 bg-background/70 xl:flex xl:flex-col">
      <div className="border-b border-border/70 px-4 py-4">
        <p className="paperclip-kicker">Operations Rail</p>
        <div className="paperclip-subpanel mt-3 px-3 py-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Radar className="h-3.5 w-3.5 text-primary" />
              Live now
            </span>
            <span className="font-medium text-foreground">{activeRuns.length}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <CircleDot className="h-3.5 w-3.5 text-primary" />
              Tasks
            </span>
            <span className="font-medium text-foreground">{summary?.tasks.inProgress ?? 0}</span>
          </div>
        </div>
        {summary && summary.budgets.activeIncidents > 0 ? (
          <div className="paperclip-subpanel mt-3 border-red-300 bg-red-50 px-3 py-3 text-sm text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-100">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-300" />
              <span className="font-medium">
                {summary.budgets.activeIncidents} active budget incident{summary.budgets.activeIncidents === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-1 text-xs text-red-700/80 dark:text-red-100/75">
              {summary.budgets.pausedAgents} paused agents and {summary.budgets.pendingApprovals} budget approvals need review.
            </p>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <section className="paperclip-panel p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="paperclip-kicker">Live Queue</p>
              <h2 className="mt-1 text-sm font-semibold">Agent traffic</h2>
            </div>
            <Link to="/agents/all" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {activeRuns.length === 0 ? (
              <div className="paperclip-subpanel paperclip-subpanel-compact px-3 py-3 text-sm text-muted-foreground">
                No active runs right now.
              </div>
            ) : (
              activeRuns.slice(0, 4).map((run) => {
                const issue = run.issueId ? issueMap.get(run.issueId) : null;
                return (
                  <Link
                    key={run.id}
                    to={`/agents/${run.agentId}/runs/${run.id}`}
                    className="paperclip-subpanel paperclip-subpanel-compact block px-3 py-3 no-underline transition-colors hover:border-primary/35 hover:bg-accent/22"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2.5 w-2.5 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/70 opacity-80" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                          </span>
                          <span className="truncate text-sm font-medium">{run.agentName}</span>
                        </div>
                        {issue ? (
                          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                            <span className="text-foreground">{issue.identifier ?? issue.id.slice(0, 8)}</span>
                            {` · ${issue.title}`}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs text-muted-foreground">System heartbeat</p>
                        )}
                      </div>
                      <span className="paperclip-pill shrink-0 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {formatLabel(run.status)}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span>{run.triggerDetail ?? run.invocationSource}</span>
                      <span>{relativeTime(run.startedAt ?? run.createdAt)}</span>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </section>

        <section className="paperclip-panel mt-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="paperclip-kicker">Portfolio</p>
              <h2 className="mt-1 text-sm font-semibold">Project pulse</h2>
            </div>
            <Link to="/projects" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
              Portfolio
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {recentProjects.length === 0 ? (
              <div className="paperclip-subpanel paperclip-subpanel-compact px-3 py-3 text-sm text-muted-foreground">
                No projects yet.
              </div>
            ) : (
              recentProjects.map((project) => {
                const openTasks = (issues ?? []).filter((issue) => issue.projectId === project.id && issue.status !== "done").length;
                return (
                  <Link
                    key={project.id}
                    to={projectUrl(project)}
                    className="paperclip-subpanel paperclip-subpanel-compact block px-3 py-3 no-underline transition-colors hover:border-primary/35 hover:bg-accent/22"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: project.color ?? "var(--primary)" }}
                          />
                          <span className="truncate text-sm font-medium">{project.name}</span>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {openTasks} open tasks · updated {relativeTime(project.updatedAt)}
                        </p>
                      </div>
                      <span className="paperclip-pill shrink-0 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {formatLabel(project.status)}
                      </span>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </section>

        <section className="paperclip-panel mt-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="paperclip-kicker">Signal</p>
              <h2 className="mt-1 text-sm font-semibold">Board activity</h2>
            </div>
            <Link to="/activity" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
              Activity log
            </Link>
          </div>
          <div className="paperclip-subpanel paperclip-subpanel-compact mt-4 overflow-hidden">
            {events.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted-foreground">No recent activity.</div>
            ) : (
              events.map((event, index) => (
                <ActivityRow
                  key={event.id}
                  event={event}
                  agentMap={agentMap}
                  entityNameMap={entityNameMap}
                  entityTitleMap={entityTitleMap}
                  className={cn(index > 0 && "border-t border-border/60")}
                />
              ))
            )}
          </div>
        </section>

        <section className="paperclip-panel mt-4 p-4">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Routing</h2>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Link to="/issues" className="paperclip-subpanel paperclip-subpanel-compact px-3 py-3 no-underline transition-colors hover:border-primary/35 hover:bg-accent/22">
              <CircleDot className="h-3.5 w-3.5 text-primary" />
              <p className="mt-2 font-medium text-foreground">Task board</p>
              <p className="mt-1 text-muted-foreground">{summary ? statText(summary.tasks.open, "open task") : "Open work"}</p>
            </Link>
            <Link to="/agents/all" className="paperclip-subpanel paperclip-subpanel-compact px-3 py-3 no-underline transition-colors hover:border-primary/35 hover:bg-accent/22">
              <Bot className="h-3.5 w-3.5 text-primary" />
              <p className="mt-2 font-medium text-foreground">Virtual office</p>
              <p className="mt-1 text-muted-foreground">{summary ? statText(summary.agents.active, "enabled agent") : "Crew roster"}</p>
            </Link>
          </div>
        </section>
      </div>
    </aside>
  );
}
