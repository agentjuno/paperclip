import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

export function InstanceExperimentalSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "Experimental" },
    ]);
  }, [setBreadcrumbs]);

  const experimentalQuery = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });

  const toggleMutation = useMutation({
    mutationFn: async (patch: { enableIsolatedWorkspaces?: boolean; autoRestartDevServerWhenIdle?: boolean }) =>
      instanceSettingsApi.updateExperimental(patch),
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.experimentalSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
      ]);
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update experimental settings.");
    },
  });

  if (experimentalQuery.isLoading) {
    return <div className="paperclip-panel rounded-[24px] px-4 py-3 text-sm text-muted-foreground">Loading experimental settings…</div>;
  }

  if (experimentalQuery.error) {
    return (
      <div className="paperclip-panel rounded-[24px] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {experimentalQuery.error instanceof Error
          ? experimentalQuery.error.message
          : "Failed to load experimental settings."}
      </div>
    );
  }

  const enableIsolatedWorkspaces = experimentalQuery.data?.enableIsolatedWorkspaces === true;
  const autoRestartDevServerWhenIdle = experimentalQuery.data?.autoRestartDevServerWhenIdle === true;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="paperclip-panel paperclip-panel-strong rounded-[28px] p-5 sm:p-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
          <FlaskConical className="h-3.5 w-3.5 text-emerald-400" />
          <span>Instance settings / experimental</span>
        </div>
        <div className="mt-3 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Experimental</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Opt into features that are still being evaluated before they become default behavior.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="paperclip-panel rounded-[24px] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <section className="space-y-4">
        <div className="paperclip-panel rounded-[28px] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Workspace isolation</div>
              <h2 className="text-base font-semibold">Enable Isolated Workspaces</h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Show execution workspace controls in project configuration and allow isolated workspace behavior for new
                and existing issue runs.
              </p>
            </div>
            <button
              type="button"
              data-slot="toggle"
              aria-label="Toggle isolated workspaces experimental setting"
              disabled={toggleMutation.isPending}
              className={cn(
                "relative inline-flex h-6 w-10 items-center rounded-full border border-border/70 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                enableIsolatedWorkspaces ? "bg-emerald-500/80" : "bg-muted/80",
              )}
              onClick={() => toggleMutation.mutate({ enableIsolatedWorkspaces: !enableIsolatedWorkspaces })}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                  enableIsolatedWorkspaces ? "translate-x-5" : "translate-x-1",
                )}
              />
            </button>
          </div>
        </div>

        <div className="paperclip-panel rounded-[28px] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Runtime behavior</div>
              <h2 className="text-base font-semibold">Auto-Restart Dev Server When Idle</h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                In `pnpm dev:once`, wait for all queued and running local agent runs to finish, then restart the server
                automatically when backend changes or migrations make the current boot stale.
              </p>
            </div>
            <button
              type="button"
              data-slot="toggle"
              aria-label="Toggle guarded dev-server auto-restart"
              disabled={toggleMutation.isPending}
              className={cn(
                "relative inline-flex h-6 w-10 items-center rounded-full border border-border/70 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                autoRestartDevServerWhenIdle ? "bg-emerald-500/80" : "bg-muted/80",
              )}
              onClick={() =>
                toggleMutation.mutate({ autoRestartDevServerWhenIdle: !autoRestartDevServerWhenIdle })
              }
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                  autoRestartDevServerWhenIdle ? "translate-x-5" : "translate-x-1",
                )}
              />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
