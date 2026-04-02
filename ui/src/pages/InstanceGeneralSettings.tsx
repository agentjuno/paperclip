import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

export function InstanceGeneralSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "General" },
    ]);
  }, [setBreadcrumbs]);

  const generalQuery = useQuery({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: () => instanceSettingsApi.getGeneral(),
  });

  const toggleMutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      instanceSettingsApi.updateGeneral({ censorUsernameInLogs: enabled }),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.generalSettings });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update general settings.");
    },
  });

  if (generalQuery.isLoading) {
    return <div className="paperclip-panel rounded-[24px] px-4 py-3 text-sm text-muted-foreground">Loading general settings…</div>;
  }

  if (generalQuery.error) {
    return (
      <div className="paperclip-panel rounded-[24px] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {generalQuery.error instanceof Error ? generalQuery.error.message : "Failed to load general settings."}
      </div>
    );
  }

  const censorUsernameInLogs = generalQuery.data?.censorUsernameInLogs === true;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="paperclip-panel paperclip-panel-strong rounded-[28px] p-5 sm:p-6">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />
          <span>Instance settings / general</span>
        </div>
        <div className="mt-3 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">General</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Configure instance-wide defaults that affect how operator-visible logs are displayed.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="paperclip-panel rounded-[24px] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <section className="paperclip-panel rounded-[28px] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Operator log mask</div>
            <h2 className="text-base font-semibold">Censor username in logs</h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Hide the username segment in home-directory paths and similar operator-visible log output. Standalone
              username mentions outside of paths are not yet masked in the live transcript view. This is off by
              default.
            </p>
          </div>
          <button
            type="button"
            data-slot="toggle"
            aria-label="Toggle username log censoring"
            disabled={toggleMutation.isPending}
            className={cn(
              "relative inline-flex h-6 w-10 items-center rounded-full border border-border/70 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              censorUsernameInLogs ? "bg-emerald-500/80" : "bg-muted/80",
            )}
            onClick={() => toggleMutation.mutate(!censorUsernameInLogs)}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                censorUsernameInLogs ? "translate-x-5" : "translate-x-1",
              )}
            />
          </button>
        </div>
      </section>
    </div>
  );
}
