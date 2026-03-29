import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Bot, CircleDot, DollarSign, FolderKanban, LayoutDashboard, PauseCircle, Radar, ShieldCheck, Workflow } from "lucide-react";
import type { Agent, Issue, Project } from "@paperclipai/shared";
import { activityApi } from "../api/activity";
import { agentsApi } from "../api/agents";
import { dashboardApi } from "../api/dashboard";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { EmptyState } from "../components/EmptyState";
import { StatusIcon } from "../components/StatusIcon";
import { ActivityRow } from "../components/ActivityRow";
import { Identity } from "../components/Identity";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { ChartCard, RunActivityChart, PriorityChart, IssueStatusChart, SuccessRateChart } from "../components/ActivityCharts";
import { PageSkeleton } from "../components/PageSkeleton";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatCents, issueUrl, projectUrl, relativeTime } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { PluginSlotOutlet } from "@/plugins/slots";

function getRecentIssues(issues: Issue[]) {
  return [...issues].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function getRecentProjects(projects: Project[]) {
  return [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function countProjectOpenIssues(issues: Issue[], projectId: string) {
  return issues.filter((issue) => issue.projectId === projectId && issue.status !== "done").length;
}

function groupProjectStatus(projects: Project[]) {
  const counts = new Map<string, number>();
  for (const project of projects) {
    counts.set(project.status, (counts.get(project.status) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
}

function commandPill(text: string) {
  return (
    <span className="paperclip-pill px-3 py-1 text-[11px] text-muted-foreground">
      {text}
    </span>
  );
}

function CommandMetricCell({
  icon: Icon,
  value,
  label,
  detail,
  to,
}: {
  icon: typeof Bot;
  value: string | number;
  label: string;
  detail: string;
  to: string;
}) {
  return (
    <Link to={to} className="command-metric-cell block px-4 py-4 text-inherit no-underline transition-colors hover:bg-accent/18">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-3xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{label}</p>
          <p className="mt-3 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className="rounded-full border border-border/70 bg-background/50 p-2.5">
          <Icon className="h-4 w-4 text-primary" />
        </div>
      </div>
    </Link>
  );
}

function PreviewWindow({
  title,
  eyebrow,
  children,
  className,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("command-preview", className)}>
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-xs font-medium text-foreground">{title}</span>
        </div>
        <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Dashboard() {
  const { selectedCompanyId, selectedCompany, companies } = useCompany();
  const { openOnboarding } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Command Center" }]);
  }, [setBreadcrumbs]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: summary, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: activity } = useQuery({
    queryKey: queryKeys.activity(selectedCompanyId!),
    queryFn: () => activityApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: runs } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: liveRuns } = useQuery({
    queryKey: [...queryKeys.liveRuns(selectedCompanyId!), "command-center"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 8_000,
  });

  const visibleProjects = useMemo(
    () => (projects ?? []).filter((project) => !project.archivedAt),
    [projects],
  );
  const recentIssues = useMemo(() => getRecentIssues(issues ?? []).slice(0, 8), [issues]);
  const recentProjects = useMemo(() => getRecentProjects(visibleProjects).slice(0, 5), [visibleProjects]);
  const recentActivity = useMemo(() => (activity ?? []).slice(0, 8), [activity]);
  const liveRunsList = liveRuns ?? [];
  const activeAgents = agents?.filter((agent) => agent.status !== "terminated") ?? [];
  const projectStatusSummary = useMemo(() => groupProjectStatus(visibleProjects), [visibleProjects]);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of agents ?? []) map.set(agent.id, agent);
    return map;
  }, [agents]);
  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues ?? []) map.set(`issue:${issue.id}`, issue.identifier ?? issue.id.slice(0, 8));
    for (const agent of agents ?? []) map.set(`agent:${agent.id}`, agent.name);
    for (const project of visibleProjects) map.set(`project:${project.id}`, project.name);
    return map;
  }, [issues, agents, visibleProjects]);
  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues ?? []) map.set(`issue:${issue.id}`, issue.title);
    return map;
  }, [issues]);

  const firstProject = recentProjects[0] ?? null;
  const hasNoAgents = agents !== undefined && agents.length === 0;
  const liveCount = liveRunsList.length;
  const approvalCount = (summary?.pendingApprovals ?? 0) + (summary?.budgets.pendingApprovals ?? 0);

  const agentName = (id: string | null) => {
    if (!id) return null;
    return agents?.find((agent) => agent.id === id)?.name ?? null;
  };

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          message="Welcome to Paperclip. Set up your first company and agent to get started."
          action="Get Started"
          onAction={openOnboarding}
        />
      );
    }
    return <EmptyState icon={LayoutDashboard} message="Create or select a company to open the command center." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  return (
    <div className="space-y-6 xl:space-y-8">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      <section className="-mx-1 md:-mx-2 xl:-mx-3">
        <div className="command-hero-shell px-4 py-8 md:px-8 md:py-10 xl:px-10 xl:py-12">
          <div className="relative z-10">
            <div className="command-fade-up max-w-3xl">
              <div className="flex flex-wrap items-center gap-3">
                <span className="paperclip-kicker">Company Building OS</span>
                <span className="rounded-full border border-primary/20 bg-primary/12 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-primary">
                  Internal
                </span>
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] md:text-6xl xl:text-7xl">
                Command Center
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
                Tasks, live agents, approvals, and project delivery for {selectedCompany?.name ?? "your company"}.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {commandPill(`${liveCount} live runs`)}
                {commandPill(`${visibleProjects.length} tracked projects`)}
                {commandPill(`${summary?.tasks.inProgress ?? 0} tasks in flight`)}
                {commandPill(`${approvalCount} approvals open`)}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  to="/issues"
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground no-underline transition-transform hover:-translate-y-0.5"
                >
                  Open task board
                </Link>
                <Link
                  to="/projects"
                  className="rounded-lg border border-border/70 bg-background/45 px-4 py-2.5 text-sm font-medium text-foreground no-underline transition-colors hover:bg-accent/30"
                >
                  Review projects
                </Link>
                <Link
                  to="/approvals/pending"
                  className="rounded-lg border border-border/70 bg-background/45 px-4 py-2.5 text-sm font-medium text-foreground no-underline transition-colors hover:bg-accent/30"
                >
                  Compliance queue
                </Link>
              </div>
            </div>

            <div className="mt-10 flex flex-col gap-4 md:min-h-[24rem] md:flex-row md:items-end">
              <PreviewWindow
                title="Command"
                eyebrow="Overview"
                className="command-fade-up command-fade-delay-1 md:h-[11.5rem] md:w-[24%] md:shrink-0 md:translate-y-14"
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    {["Board Visibility", "Live Work", "Approvals", "Costs", "Monitoring"].map((item, index) => (
                      <div key={item} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span className={cn("h-2 w-2 rounded-full", index === 1 ? "bg-primary" : "bg-muted")} />
                          {item}
                        </span>
                        <span className="text-foreground">{index === 1 ? `${liveCount} live` : "Ready"}</span>
                      </div>
                    ))}
                  </div>
                  <div className="paperclip-soft-divider" />
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-2xl font-semibold text-foreground">{summary?.agents.running ?? 0}</p>
                      <p className="mt-1 text-muted-foreground">running agents</p>
                    </div>
                    <div>
                      <p className="text-2xl font-semibold text-foreground">{summary?.tasks.blocked ?? 0}</p>
                      <p className="mt-1 text-muted-foreground">blocked tasks</p>
                    </div>
                  </div>
                </div>
              </PreviewWindow>

              <PreviewWindow
                title="Task Board"
                eyebrow="Execution"
                className="command-fade-up command-fade-delay-2 md:-ml-8 md:h-[21rem] md:w-[34%] md:shrink-0"
              >
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    <span>Active queue</span>
                    <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                    <span>{summary?.tasks.inProgress ?? 0} in progress</span>
                  </div>
                  {recentIssues.slice(0, 4).map((issue) => (
                    <div key={issue.id} className="paperclip-subpanel paperclip-subpanel-compact px-3 py-3">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 shrink-0">
                          <StatusIcon status={issue.status} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <p className="line-clamp-2 text-sm font-medium">{issue.title}</p>
                            <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                              {formatLabel(issue.status)}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{issue.identifier ?? issue.id.slice(0, 8)}</span>
                            {agentName(issue.assigneeAgentId) ? <span>{agentName(issue.assigneeAgentId)}</span> : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </PreviewWindow>

              <PreviewWindow
                title="Project Delivery"
                eyebrow="Portfolio"
                className="command-fade-up command-fade-delay-3 command-float-slow md:-ml-10 md:h-[16rem] md:w-[42%] md:flex-1"
              >
                <div className="space-y-4">
                  {firstProject ? (
                    <>
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: firstProject.color ?? "var(--primary)" }}
                          />
                          <h2 className="text-sm font-semibold">{firstProject.name}</h2>
                          <span className="rounded-full border border-border/70 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                            {formatLabel(firstProject.status)}
                          </span>
                        </div>
                        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                          {firstProject.description ?? "Primary project delivery surface."}
                        </p>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: "Brief", value: "Ready" },
                          { label: "Tasks", value: String(countProjectOpenIssues(issues ?? [], firstProject.id)) },
                          { label: "Agents", value: String(activeAgents.length) },
                          { label: "Updated", value: relativeTime(firstProject.updatedAt) },
                        ].map((item) => (
                          <div key={item.label} className="paperclip-subpanel paperclip-subpanel-compact px-3 py-3">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{item.label}</p>
                            <p className="mt-2 text-sm font-medium">{item.value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="paperclip-subpanel px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Delivery strip</p>
                            <p className="mt-1 text-sm font-medium">Current program state</p>
                          </div>
                          <Workflow className="h-4 w-4 text-primary" />
                        </div>
                        <div className="mt-4 flex items-center gap-2 overflow-hidden">
                          {["Brief", "Plan", "Build", "Review", "Ship"].map((step, index) => (
                            <div key={step} className="flex min-w-0 flex-1 items-center gap-2">
                              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", index < 3 ? "bg-primary" : "bg-muted")} />
                              <span className="truncate text-xs text-muted-foreground">{step}</span>
                              {index < 4 ? <span className="h-px flex-1 bg-border/70" /> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="paperclip-subpanel px-4 py-10 text-center text-sm text-muted-foreground">
                      Add a project to turn the delivery strip on.
                    </div>
                  )}
                </div>
              </PreviewWindow>
            </div>
          </div>
        </div>
      </section>

      {hasNoAgents && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/10">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Bot className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
              <p className="text-sm text-amber-900 dark:text-amber-50">This company has no agents yet.</p>
            </div>
            <button
              onClick={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
              className="text-sm font-medium text-amber-800 underline underline-offset-2 dark:text-amber-200"
            >
              Add one
            </button>
          </div>
        </div>
      )}

      {summary && summary.budgets.activeIncidents > 0 ? (
        <div className="rounded-lg border border-red-300 bg-[linear-gradient(180deg,rgba(254,242,242,0.96),rgba(255,255,255,0.92))] px-4 py-4 dark:border-red-500/20 dark:bg-[linear-gradient(180deg,rgba(255,80,80,0.12),rgba(255,255,255,0.02))]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-300" />
              <div>
                <p className="text-sm font-medium text-red-900 dark:text-red-50">
                  {summary.budgets.activeIncidents} active budget incident{summary.budgets.activeIncidents === 1 ? "" : "s"}
                </p>
                <p className="mt-1 text-xs text-red-800/80 dark:text-red-100/70">
                  {summary.budgets.pausedAgents} agents paused · {summary.budgets.pausedProjects} projects paused · {summary.budgets.pendingApprovals} budget approvals pending
                </p>
              </div>
            </div>
            <Link to="/costs" className="text-sm text-red-800 underline underline-offset-2 dark:text-red-100">
              Open budgets
            </Link>
          </div>
        </div>
      ) : null}

      <section className="command-metric-rail grid overflow-hidden grid-cols-2 xl:grid-cols-5">
        <CommandMetricCell
          icon={Bot}
          value={(summary?.agents.active ?? 0) + (summary?.agents.running ?? 0) + (summary?.agents.paused ?? 0) + (summary?.agents.error ?? 0)}
          label="Agents Enabled"
          detail={`${summary?.agents.running ?? 0} running · ${summary?.agents.error ?? 0} errors`}
          to="/agents/all"
        />
        <CommandMetricCell
          icon={CircleDot}
          value={summary?.tasks.inProgress ?? 0}
          label="Tasks In Progress"
          detail={`${summary?.tasks.open ?? 0} open · ${summary?.tasks.blocked ?? 0} blocked`}
          to="/issues"
        />
        <CommandMetricCell
          icon={FolderKanban}
          value={visibleProjects.length}
          label="Projects Tracked"
          detail={recentProjects.length > 0 ? `Latest update ${relativeTime(recentProjects[0]!.updatedAt)}` : "No live projects yet"}
          to="/projects"
        />
        <CommandMetricCell
          icon={DollarSign}
          value={formatCents(summary?.costs.monthSpendCents ?? 0)}
          label="Month Spend"
          detail={(summary?.costs.monthBudgetCents ?? 0) > 0
            ? `${summary?.costs.monthUtilizationPercent ?? 0}% of ${formatCents(summary?.costs.monthBudgetCents ?? 0)} budget`
            : "Unlimited budget"}
          to="/costs"
        />
        <CommandMetricCell
          icon={ShieldCheck}
          value={approvalCount}
          label="Pending Approvals"
          detail={(summary?.budgets.pendingApprovals ?? 0) > 0 ? `${summary?.budgets.pendingApprovals ?? 0} budget overrides need review` : "Board review queue"}
          to="/approvals/pending"
        />
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_16.5rem]">
        <ActiveAgentsPanel companyId={selectedCompanyId!} />

        <div className="paperclip-panel p-5 xl:sticky xl:top-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="paperclip-kicker">Delivery Focus</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">Selected projects</h2>
            </div>
            <Link to="/projects" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Portfolio
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {recentProjects.length === 0 ? (
              <div className="paperclip-subpanel px-4 py-4 text-sm text-muted-foreground">
                No projects yet.
              </div>
            ) : (
              recentProjects.map((project) => (
                <Link
                  key={project.id}
                  to={projectUrl(project)}
                  className="paperclip-subpanel block px-4 py-4 text-inherit no-underline transition-colors hover:border-primary/30 hover:bg-accent/25"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color ?? "var(--primary)" }} />
                        <span className="truncate text-sm font-medium">{project.name}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                        {project.description ?? "No project description yet."}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-border/70 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {formatLabel(project.status)}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{countProjectOpenIssues(issues ?? [], project.id)} open tasks</span>
                    <span>updated {relativeTime(project.updatedAt)}</span>
                  </div>
                </Link>
              ))
            )}
            {projectStatusSummary.length > 0 ? (
              <div className="paperclip-subpanel px-4 py-4">
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Portfolio mix</p>
                <div className="mt-3 space-y-2">
                  {projectStatusSummary.map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{formatLabel(status)}</span>
                      <span className="font-medium text-foreground">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="paperclip-panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="paperclip-kicker">Task Board</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">Recent tasks</h2>
            </div>
            <Link to="/issues" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              View all
            </Link>
          </div>
          <div className="paperclip-subpanel mt-4 overflow-hidden">
            {recentIssues.length === 0 ? (
              <div className="px-4 py-4 text-sm text-muted-foreground">No tasks yet.</div>
            ) : (
              recentIssues.map((issue, index) => (
                <Link
                  key={issue.id}
                  to={issueUrl(issue)}
                  className={cn(
                    "block px-4 py-3 text-sm text-inherit no-underline transition-colors hover:bg-accent/25",
                    index > 0 && "border-t border-border/60",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0">
                      <StatusIcon status={issue.status} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="line-clamp-2 text-sm font-medium">{issue.title}</p>
                        <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(issue.updatedAt)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{issue.identifier ?? issue.id.slice(0, 8)}</span>
                        {issue.project?.name ? <span>{issue.project.name}</span> : null}
                        {issue.assigneeAgentId && agentName(issue.assigneeAgentId) ? (
                          <Identity name={agentName(issue.assigneeAgentId)!} size="sm" />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="paperclip-panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="paperclip-kicker">Signal</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">Recent board activity</h2>
            </div>
            <Link to="/activity" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              Activity log
            </Link>
          </div>
          <div className="paperclip-subpanel mt-4 overflow-hidden">
            {recentActivity.length === 0 ? (
              <div className="px-4 py-4 text-sm text-muted-foreground">No recent activity.</div>
            ) : (
              recentActivity.map((event, index) => (
                <ActivityRow
                  key={event.id}
                  event={event}
                  agentMap={agentMap}
                  entityNameMap={entityNameMap}
                  entityTitleMap={entityTitleMap}
                  className={index > 0 ? "border-t border-border/60" : undefined}
                />
              ))
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link to="/agents/all" className="paperclip-subpanel px-4 py-4 no-underline transition-colors hover:border-primary/30 hover:bg-accent/25">
              <Radar className="h-4 w-4 text-primary" />
              <p className="mt-3 text-sm font-medium text-foreground">Virtual office</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {summary?.agents.running ?? 0} agents running and {liveCount} live sessions.
              </p>
            </Link>
            <Link to="/approvals/pending" className="paperclip-subpanel px-4 py-4 no-underline transition-colors hover:border-primary/30 hover:bg-accent/25">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <p className="mt-3 text-sm font-medium text-foreground">Governance</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {approvalCount} approvals currently waiting for board review.
              </p>
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ChartCard title="Run Activity" subtitle="Last 14 days">
          <RunActivityChart runs={runs ?? []} />
        </ChartCard>
        <ChartCard title="Issues by Priority" subtitle="Last 14 days">
          <PriorityChart issues={issues ?? []} />
        </ChartCard>
        <ChartCard title="Issues by Status" subtitle="Last 14 days">
          <IssueStatusChart issues={issues ?? []} />
        </ChartCard>
        <ChartCard title="Success Rate" subtitle="Last 14 days">
          <SuccessRateChart runs={runs ?? []} />
        </ChartCard>
      </div>

      <PluginSlotOutlet
        slotTypes={["dashboardWidget"]}
        context={{ companyId: selectedCompanyId }}
        className="grid gap-4 md:grid-cols-2"
        itemClassName="paperclip-panel p-4"
      />
    </div>
  );
}
