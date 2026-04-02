import { useEffect, useMemo, useCallback } from "react";
import { useLocation, useSearchParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { createIssueDetailLocationState } from "../lib/issueDetailBreadcrumb";
import { EmptyState } from "../components/EmptyState";
import { IssuesList } from "../components/IssuesList";
import { CircleDot } from "lucide-react";

export function Issues() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const initialSearch = searchParams.get("q") ?? "";
  const participantAgentId = searchParams.get("participantAgentId") ?? undefined;
  const handleSearchChange = useCallback((search: string) => {
    const trimmedSearch = search.trim();
    const currentSearch = new URLSearchParams(window.location.search).get("q") ?? "";
    if (currentSearch === trimmedSearch) return;

    const url = new URL(window.location.href);
    if (trimmedSearch) {
      url.searchParams.set("q", trimmedSearch);
    } else {
      url.searchParams.delete("q");
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, []);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 5000,
  });

  const liveIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of liveRuns ?? []) {
      if (run.issueId) ids.add(run.issueId);
    }
    return ids;
  }, [liveRuns]);

  const issueLinkState = useMemo(
    () =>
      createIssueDetailLocationState(
        "Tasks",
        `${location.pathname}${location.search}${location.hash}`,
      ),
    [location.pathname, location.search, location.hash],
  );

  useEffect(() => {
    setBreadcrumbs([{ label: "Tasks" }]);
  }, [setBreadcrumbs]);

  const { data: issues, isLoading, error } = useQuery({
    queryKey: [...queryKeys.issues.list(selectedCompanyId!), "participant-agent", participantAgentId ?? "__all__"],
    queryFn: () => issuesApi.list(selectedCompanyId!, { participantAgentId }),
    enabled: !!selectedCompanyId,
  });
  const issueCount = issues?.length ?? 0;
  const liveCount = liveIssueIds.size;
  const agentCount = agents?.length ?? 0;
  const projectCount = projects?.length ?? 0;

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId!) });
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={CircleDot} message="Select a company to view tasks." />;
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <section className="paperclip-panel paperclip-panel-strong command-fade-up rounded-[var(--paperclip-radius-shell)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="space-y-2">
              <p className="paperclip-kicker">Task Index</p>
              <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:gap-4">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.4rem]">Tasks</h1>
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  Operational queue across agents, live runs, and project delivery.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/55 px-3 py-1.5 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{issueCount}</span>
                total
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 font-mono uppercase tracking-[0.16em] text-primary">
                <span>{liveCount}</span>
                live
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/55 px-3 py-1.5 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{agentCount}</span>
                agents
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/55 px-3 py-1.5 font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <span className="text-foreground">{projectCount}</span>
                projects
              </span>
            </div>
          </div>

          <div className="hidden gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground xl:grid xl:max-w-sm">
            <span>{liveCount > 0 ? `${liveCount} live task runs are attached to the queue` : "No tasks are currently running live"}</span>
            <span className="text-muted-foreground/75">List for scanning, board for handoff and flow control.</span>
          </div>
        </div>
      </section>

      <IssuesList
        issues={issues ?? []}
        isLoading={isLoading}
        error={error as Error | null}
        agents={agents}
        projects={projects}
        liveIssueIds={liveIssueIds}
        viewStateKey="paperclip:issues-view"
        issueLinkState={issueLinkState}
        initialAssignees={searchParams.get("assignee") ? [searchParams.get("assignee")!] : undefined}
        initialSearch={initialSearch}
        onSearchChange={handleSearchChange}
        onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
        searchFilters={participantAgentId ? { participantAgentId } : undefined}
      />
    </div>
  );
}
