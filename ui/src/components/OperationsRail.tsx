import { useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { deriveProjectUrlKey, type ActivityEvent, type Agent, type Issue } from "@paperclipai/shared";
import { AlertTriangle, Bot, CircleDot, FolderKanban, Radar, type LucideIcon } from "lucide-react";
import { Link } from "@/lib/router";
import { activityApi } from "../api/activity";
import { agentsApi } from "../api/agents";
import { dashboardApi } from "../api/dashboard";
import { goalsApi } from "../api/goals";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { cn, projectUrl, relativeTime } from "../lib/utils";

type TickerTone = "summary" | "incident" | "live" | "portfolio" | "signal" | "routing";

interface TickerItem {
  key: string;
  tone: TickerTone;
  label: string;
  text: string;
  meta?: string;
  to?: string | null;
  icon: LucideIcon;
}

const TICKER_TONE_STYLES: Record<TickerTone, { chip: string; icon: string; label: string; meta: string }> = {
  summary: {
    chip: "border-slate-300/80 bg-slate-100/85 text-slate-900 dark:border-slate-400/20 dark:bg-slate-400/10 dark:text-slate-100",
    icon: "text-slate-700 dark:text-slate-200",
    label: "text-slate-600 dark:text-slate-300",
    meta: "text-slate-700/75 dark:text-slate-200/70",
  },
  incident: {
    chip: "border-red-300/80 bg-red-50/90 text-red-900 dark:border-red-500/25 dark:bg-red-500/12 dark:text-red-100",
    icon: "text-red-700 dark:text-red-200",
    label: "text-red-700 dark:text-red-200",
    meta: "text-red-700/80 dark:text-red-200/70",
  },
  live: {
    chip: "border-emerald-300/80 bg-emerald-50/90 text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-500/12 dark:text-emerald-100",
    icon: "text-emerald-700 dark:text-emerald-200",
    label: "text-emerald-700 dark:text-emerald-200",
    meta: "text-emerald-800/75 dark:text-emerald-200/70",
  },
  portfolio: {
    chip: "border-amber-300/80 bg-amber-50/90 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/12 dark:text-amber-100",
    icon: "text-amber-700 dark:text-amber-200",
    label: "text-amber-700 dark:text-amber-200",
    meta: "text-amber-800/75 dark:text-amber-200/70",
  },
  signal: {
    chip: "border-cyan-300/80 bg-cyan-50/90 text-cyan-950 dark:border-cyan-500/25 dark:bg-cyan-500/12 dark:text-cyan-100",
    icon: "text-cyan-700 dark:text-cyan-200",
    label: "text-cyan-700 dark:text-cyan-200",
    meta: "text-cyan-800/75 dark:text-cyan-200/70",
  },
  routing: {
    chip: "border-blue-300/80 bg-blue-50/90 text-blue-950 dark:border-blue-500/25 dark:bg-blue-500/12 dark:text-blue-100",
    icon: "text-blue-700 dark:text-blue-200",
    label: "text-blue-700 dark:text-blue-200",
    meta: "text-blue-800/75 dark:text-blue-200/70",
  },
};

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}

function statText(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function formatActivityAction(action: string) {
  const [, ...rest] = action.split(".");
  return (rest.length > 0 ? rest : [action]).join(" ").replace(/_/g, " ");
}

function entityLink(entityType: string, entityId: string, name?: string | null): string | null {
  switch (entityType) {
    case "issue":
      return `/issues/${name ?? entityId}`;
    case "agent":
      return `/agents/${entityId}`;
    case "project":
      return `/projects/${deriveProjectUrlKey(name, entityId)}`;
    case "goal":
      return `/goals/${entityId}`;
    case "approval":
      return `/approvals/${entityId}`;
    default:
      return null;
  }
}

function resolveActivityLink(event: ActivityEvent, entityNameMap: Map<string, string>) {
  const isHeartbeatEvent = event.entityType === "heartbeat_run";
  const heartbeatAgentId = isHeartbeatEvent
    ? (event.details as Record<string, unknown> | null)?.agentId as string | undefined
    : undefined;

  if (isHeartbeatEvent && heartbeatAgentId) {
    return `/agents/${heartbeatAgentId}/runs/${event.entityId}`;
  }

  const name = entityNameMap.get(`${event.entityType}:${event.entityId}`);
  return entityLink(event.entityType, event.entityId, name);
}

function resolveActivityActor(event: ActivityEvent, agentMap: Map<string, Agent>) {
  if (event.actorType === "agent") {
    return agentMap.get(event.actorId)?.name ?? "Agent";
  }
  if (event.actorType === "system") {
    return "System";
  }
  if (event.actorType === "user") {
    return "Board";
  }
  return event.actorId || "Unknown";
}

function resolveActivityEntity(
  event: ActivityEvent,
  entityNameMap: Map<string, string>,
  agentMap: Map<string, Agent>,
) {
  if (event.entityType === "heartbeat_run") {
    const heartbeatAgentId = (event.details as Record<string, unknown> | null)?.agentId as string | undefined;
    return heartbeatAgentId ? `${agentMap.get(heartbeatAgentId)?.name ?? "Agent"} heartbeat` : "System heartbeat";
  }

  return entityNameMap.get(`${event.entityType}:${event.entityId}`) ?? formatLabel(event.entityType);
}

interface TickerChipProps {
  item: TickerItem;
  interactive?: boolean;
  onEngage?: () => void;
  onRelease?: () => void;
}

function TickerChip({ item, interactive = true, onEngage, onRelease }: TickerChipProps) {
  const tone = TICKER_TONE_STYLES[item.tone];
  const classes = cn(
    "operations-ticker-chip paperclip-subpanel paperclip-subpanel-compact inline-flex h-8 items-center gap-2 rounded-[var(--paperclip-radius-compact)] px-3 text-[12px] leading-none whitespace-nowrap",
    tone.chip,
    interactive && item.to && "transition-transform duration-150 hover:-translate-y-px",
    !interactive && "pointer-events-none select-none",
  );

  const content = (
    <>
      <item.icon className={cn("h-3.5 w-3.5 shrink-0", tone.icon)} />
      <span className={cn("paperclip-kicker text-[0.58rem] tracking-[0.18em]", tone.label)}>{item.label}</span>
      <span className="font-medium">{truncateText(item.text, 96)}</span>
      {item.meta ? <span className={cn("text-[11px]", tone.meta)}>// {truncateText(item.meta, 72)}</span> : null}
    </>
  );

  if (interactive && item.to) {
    return (
      <Link
        to={item.to}
        className={cn(classes, "no-underline")}
        onMouseEnter={onEngage}
        onMouseLeave={onRelease}
        onFocus={onEngage}
        onBlur={onRelease}
      >
        {content}
      </Link>
    );
  }

  return (
    <div className={classes} aria-hidden={!interactive || undefined}>
      {content}
    </div>
  );
}

export function OperationsRail({ companyId }: { companyId: string | null | undefined }) {
  const [tickerPaused, setTickerPaused] = useState(false);
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
  const openTaskCountByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const issue of issues ?? []) {
      if (!issue.projectId || issue.status === "done") continue;
      map.set(issue.projectId, (map.get(issue.projectId) ?? 0) + 1);
    }
    return map;
  }, [issues]);

  const activeRuns = liveRuns ?? [];
  const events = (activity ?? []).slice(0, 6);

  const tickerItems = useMemo<TickerItem[]>(() => {
    const items: TickerItem[] = [];

    items.push({
      key: "summary",
      tone: "summary",
      label: "Ops",
      icon: Radar,
      text: `${activeRuns.length} live now / ${summary?.tasks.inProgress ?? 0} tasks in progress / ${summary?.agents.active ?? 0} agents enabled`,
      meta: summary ? `${statText(summary.tasks.open, "open task")} / ${summary.budgets.pendingApprovals} approvals pending` : undefined,
    });

    if (summary && summary.budgets.activeIncidents > 0) {
      items.push({
        key: "incident",
        tone: "incident",
        label: "Budget",
        icon: AlertTriangle,
        text: `${summary.budgets.activeIncidents} active incident${summary.budgets.activeIncidents === 1 ? "" : "s"} / ${summary.budgets.pausedAgents} paused agents`,
        meta: `${summary.budgets.pendingApprovals} approvals need review`,
      });
    }

    if (activeRuns.length === 0) {
      items.push({
        key: "live-empty",
        tone: "live",
        label: "Live",
        icon: Radar,
        text: "No active runs right now",
        meta: "Waiting for the next heartbeat",
      });
    } else {
      for (const run of activeRuns.slice(0, 4)) {
        const issue = run.issueId ? issueMap.get(run.issueId) : null;
        items.push({
          key: run.id,
          tone: "live",
          label: "Live",
          icon: Radar,
          to: `/agents/${run.agentId}/runs/${run.id}`,
          text: `${run.agentName} / ${issue ? `${issue.identifier ?? issue.id.slice(0, 8)} ${issue.title}` : run.triggerDetail ?? run.invocationSource}`,
          meta: `${formatLabel(run.status)} / ${relativeTime(run.startedAt ?? run.createdAt)}`,
        });
      }
    }

    if (recentProjects.length === 0) {
      items.push({
        key: "projects-empty",
        tone: "portfolio",
        label: "Portfolio",
        icon: FolderKanban,
        to: "/projects",
        text: "No projects yet",
        meta: "Create a project to start routing work",
      });
    } else {
      for (const project of recentProjects) {
        items.push({
          key: project.id,
          tone: "portfolio",
          label: "Portfolio",
          icon: FolderKanban,
          to: projectUrl(project),
          text: `${project.name} / ${(openTaskCountByProject.get(project.id) ?? 0)} open tasks`,
          meta: `${formatLabel(project.status)} / updated ${relativeTime(project.updatedAt)}`,
        });
      }
    }

    if (events.length === 0) {
      items.push({
        key: "activity-empty",
        tone: "signal",
        label: "Signal",
        icon: CircleDot,
        to: "/activity",
        text: "No recent activity",
        meta: "Board updates will surface here",
      });
    } else {
      for (const event of events) {
        const actorName = resolveActivityActor(event, agentMap);
        const entityName = resolveActivityEntity(event, entityNameMap, agentMap);
        const entityTitle = entityTitleMap.get(`${event.entityType}:${event.entityId}`);
        items.push({
          key: event.id,
          tone: "signal",
          label: "Signal",
          icon: CircleDot,
          to: resolveActivityLink(event, entityNameMap),
          text: entityTitle ? `${entityName} / ${entityTitle}` : entityName,
          meta: `${actorName} / ${formatActivityAction(event.action)} / ${relativeTime(event.createdAt)}`,
        });
      }
    }

    items.push({
      key: "routing-issues",
      tone: "routing",
      label: "Route",
      icon: CircleDot,
      to: "/issues",
      text: `Task board / ${summary ? statText(summary.tasks.open, "open task") : "Open work"}`,
      meta: "Inspect the work queue",
    });

    items.push({
      key: "routing-agents",
      tone: "routing",
      label: "Route",
      icon: Bot,
      to: "/agents/all",
      text: `Virtual office / ${summary ? statText(summary.agents.active, "enabled agent") : "Crew roster"}`,
      meta: "Jump into active crews",
    });

    return items;
  }, [activeRuns, agentMap, entityNameMap, entityTitleMap, events, issueMap, openTaskCountByProject, recentProjects, summary]);

  const tickerStyle = useMemo(
    () =>
      ({
        "--operations-ticker-duration": `${Math.max(36, Math.min(96, tickerItems.length * 5))}s`,
        animationPlayState: tickerPaused ? "paused" : "running",
      }) as CSSProperties,
    [tickerItems.length, tickerPaused],
  );

  if (!companyId) return null;

  return (
    <aside className="hidden shrink-0 border-t border-border/70 bg-background/94 backdrop-blur supports-[backdrop-filter]:bg-background/82 md:flex">
      <div
        className="operations-ticker-shell flex h-12 w-full items-center gap-3 overflow-hidden px-3 xl:px-4"
        onMouseEnter={() => setTickerPaused(true)}
        onMouseLeave={() => setTickerPaused(false)}
      >
        <div className="operations-ticker-chip paperclip-pill flex h-8 shrink-0 items-center gap-2 rounded-[var(--paperclip-radius-compact)] px-3 text-[11px] text-foreground">
          <Radar className="h-3.5 w-3.5 text-primary" />
          <span className="paperclip-kicker text-[0.58rem] tracking-[0.18em]">Operations</span>
          <span className="text-muted-foreground">{activeRuns.length} live</span>
        </div>

        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-background via-background/88 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-background via-background/88 to-transparent" />
          <div className="operations-ticker-viewport">
            <div className="operations-ticker-track" style={tickerStyle}>
              <div className="operations-ticker-group">
                {tickerItems.map((item) => (
                  <TickerChip
                    key={item.key}
                    item={item}
                    onEngage={() => setTickerPaused(true)}
                    onRelease={() => setTickerPaused(false)}
                  />
                ))}
              </div>
              <div className="operations-ticker-group operations-ticker-group-clone" aria-hidden="true">
                {tickerItems.map((item) => (
                  <TickerChip key={`${item.key}-clone`} item={item} interactive={false} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
