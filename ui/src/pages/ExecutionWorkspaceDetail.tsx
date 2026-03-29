import { Link, useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { executionWorkspacesApi } from "../api/execution-workspaces";
import { queryKeys } from "../lib/queryKeys";

function isSafeExternalUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="w-28 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 text-sm">{children}</div>
    </div>
  );
}

export function ExecutionWorkspaceDetail() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const { data: workspace, isLoading, error } = useQuery({
    queryKey: queryKeys.executionWorkspaces.detail(workspaceId!),
    queryFn: () => executionWorkspacesApi.get(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load workspace"}</p>;
  if (!workspace) return null;

  const shellClassName =
    "rounded-3xl border border-border/70 bg-background/35 shadow-[0_24px_80px_rgba(0,0,0,0.22)] backdrop-blur-sm";

  return (
    <div className="max-w-3xl space-y-6">
      <section className={`${shellClassName} p-5 sm:p-6 space-y-5`}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            <span>Execution workspace</span>
            <span className="h-1 w-1 rounded-full bg-emerald-400/80" />
            <span>{workspace.status}</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{workspace.name}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {workspace.mode} workspace on {workspace.providerType} with branch-aware execution context and cleanup tracking.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span className="rounded-full border border-border/70 bg-background/50 px-2.5 py-1">{workspace.mode}</span>
            <span className="rounded-full border border-border/70 bg-background/50 px-2.5 py-1">{workspace.providerType}</span>
            {workspace.branchName && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">{workspace.branchName}</span>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Status</div>
            <div className="mt-1 text-sm">{workspace.status}</div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Mode</div>
            <div className="mt-1 text-sm">{workspace.mode}</div>
          </div>
        </div>
      </section>

      <section className={`${shellClassName} overflow-hidden`}>
        <div className="border-b border-border/70 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Context
        </div>
        <div className="grid gap-0 divide-y divide-border/70 p-5 sm:p-6">
          <DetailRow label="Project">
            {workspace.projectId ? <Link to={`/projects/${workspace.projectId}`} className="hover:underline">{workspace.projectId}</Link> : "None"}
          </DetailRow>
          <DetailRow label="Source issue">
            {workspace.sourceIssueId ? <Link to={`/issues/${workspace.sourceIssueId}`} className="hover:underline">{workspace.sourceIssueId}</Link> : "None"}
          </DetailRow>
          <DetailRow label="Branch">{workspace.branchName ?? "None"}</DetailRow>
          <DetailRow label="Base ref">{workspace.baseRef ?? "None"}</DetailRow>
          <DetailRow label="Working dir">
            <span className="break-all font-mono text-xs">{workspace.cwd ?? "None"}</span>
          </DetailRow>
          <DetailRow label="Provider ref">
            <span className="break-all font-mono text-xs">{workspace.providerRef ?? "None"}</span>
          </DetailRow>
          <DetailRow label="Repo URL">
            {workspace.repoUrl && isSafeExternalUrl(workspace.repoUrl) ? (
              <a href={workspace.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                {workspace.repoUrl}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : workspace.repoUrl ? (
              <span className="break-all font-mono text-xs">{workspace.repoUrl}</span>
            ) : "None"}
          </DetailRow>
          <DetailRow label="Opened">{new Date(workspace.openedAt).toLocaleString()}</DetailRow>
          <DetailRow label="Last used">{new Date(workspace.lastUsedAt).toLocaleString()}</DetailRow>
          <DetailRow label="Cleanup">
            {workspace.cleanupEligibleAt ? `${new Date(workspace.cleanupEligibleAt).toLocaleString()}${workspace.cleanupReason ? ` · ${workspace.cleanupReason}` : ""}` : "Not scheduled"}
          </DetailRow>
        </div>
      </section>
    </div>
  );
}
