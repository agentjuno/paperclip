import { useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@paperclipai/shared";
import { heartbeatsApi, type LiveRunForIssue } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import type { TranscriptEntry } from "../adapters";
import { queryKeys } from "../lib/queryKeys";
import { cn, relativeTime } from "../lib/utils";
import { ExternalLink } from "lucide-react";
import { Identity } from "./Identity";
import { RunTranscriptView } from "./transcript/RunTranscriptView";
import { useLiveRunTranscripts } from "./transcript/useLiveRunTranscripts";

const MIN_DASHBOARD_RUNS = 4;

function isRunActive(run: LiveRunForIssue): boolean {
  return run.status === "queued" || run.status === "running";
}

interface ActiveAgentsPanelProps {
  companyId: string;
}

export function ActiveAgentsPanel({ companyId }: ActiveAgentsPanelProps) {
  const { data: liveRuns } = useQuery({
    queryKey: [...queryKeys.liveRuns(companyId), "dashboard"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId, MIN_DASHBOARD_RUNS),
  });

  const runs = liveRuns ?? [];
  const runCountByAgent = useMemo(() => {
    const map = new Map<string, number>();
    for (const run of runs) {
      map.set(run.agentId, (map.get(run.agentId) ?? 0) + 1);
    }
    return map;
  }, [runs]);
  const displayRuns = useMemo(() => {
    const seen = new Set<string>();
    return runs.filter((run) => {
      if (seen.has(run.agentId)) return false;
      seen.add(run.agentId);
      return true;
    });
  }, [runs]);
  const activeRunCount = useMemo(
    () => displayRuns.filter((run) => isRunActive(run)).length,
    [displayRuns],
  );
  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(companyId),
    queryFn: () => issuesApi.list(companyId),
    enabled: displayRuns.length > 0,
  });

  const issueById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues ?? []) {
      map.set(issue.id, issue);
    }
    return map;
  }, [issues]);

  const { transcriptByRun, hasOutputForRun } = useLiveRunTranscripts({
    runs,
    companyId,
    maxChunksPerRun: 120,
  });

  return (
    <section className="paperclip-panel p-5">
      <div className="space-y-3">
        <div>
          <p className="paperclip-kicker">Virtual Office</p>
          <h3 className="mt-1 text-lg font-semibold tracking-tight">Live agent activity</h3>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Current run, task context, and latest transcript signal for each active operator.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <div className="paperclip-subpanel paperclip-subpanel-compact px-3 py-2">
            <p className="paperclip-kicker">Agents surfaced</p>
            <p className="mt-1 text-base font-semibold text-foreground">{displayRuns.length}</p>
          </div>
          <div className="paperclip-subpanel paperclip-subpanel-compact px-3 py-2">
            <p className="paperclip-kicker">Live now</p>
            <p className="mt-1 text-base font-semibold text-foreground">{activeRunCount}</p>
          </div>
        </div>
      </div>
      {displayRuns.length === 0 ? (
        <div className="paperclip-subpanel mt-4 p-4">
          <p className="text-sm text-muted-foreground">No recent agent runs.</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {displayRuns.map((run) => (
            <AgentRunCard
              key={run.id}
              run={run}
              issue={run.issueId ? issueById.get(run.issueId) : undefined}
              transcript={transcriptByRun.get(run.id) ?? []}
              hasOutput={hasOutputForRun(run.id)}
              isActive={isRunActive(run)}
              additionalRuns={(runCountByAgent.get(run.agentId) ?? 1) - 1}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AgentRunCard({
  run,
  issue,
  transcript,
  hasOutput,
  isActive,
  additionalRuns,
}: {
  run: LiveRunForIssue;
  issue?: Issue;
  transcript: TranscriptEntry[];
  hasOutput: boolean;
  isActive: boolean;
  additionalRuns: number;
}) {
  return (
    <div className={cn(
      "paperclip-subpanel flex h-[248px] flex-col overflow-hidden",
      isActive
        ? "border-primary/25 bg-primary/[0.05] shadow-[0_20px_48px_rgba(0,0,0,0.24)]"
        : "",
    )}
    data-live-agent-card
    >
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isActive ? (
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
              ) : (
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-muted-foreground/35" />
              )}
              <Identity name={run.agentName} size="sm" className="[&>span:last-child]:!text-[11px]" />
              {additionalRuns > 0 ? (
                <span
                  className="paperclip-pill px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  title={`${additionalRuns} additional recent run${additionalRuns === 1 ? "" : "s"}`}
                >
                  +{additionalRuns}
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>{isActive ? "Live now" : run.finishedAt ? `Finished ${relativeTime(run.finishedAt)}` : `Started ${relativeTime(run.createdAt)}`}</span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
              <span className="uppercase tracking-[0.18em]">{run.adapterType}</span>
            </div>
          </div>

          <Link
            to={`/agents/${run.agentId}/runs/${run.id}`}
            className="paperclip-pill inline-flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        </div>

        {run.issueId && (
          <div className="paperclip-subpanel paperclip-subpanel-compact mt-3 px-3 py-2.5 text-xs">
            <Link
              to={`/issues/${issue?.identifier ?? run.issueId}`}
              className={cn(
                "line-clamp-2 hover:underline",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              title={issue?.title ? `${issue?.identifier ?? run.issueId.slice(0, 8)} - ${issue.title}` : issue?.identifier ?? run.issueId.slice(0, 8)}
            >
              {issue?.identifier ?? run.issueId.slice(0, 8)}
              {issue?.title ? ` - ${issue.title}` : ""}
            </Link>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-4 py-3">
        <RunTranscriptView
          entries={transcript}
          density="compact"
          limit={3}
          streaming={isActive}
          collapseStdout
          className="space-y-2"
          thinkingClassName="!text-[10px] !leading-4"
          emptyMessage={hasOutput ? "Waiting for transcript parsing..." : isActive ? "Waiting for output..." : "No transcript captured."}
        />
      </div>
    </div>
  );
}
