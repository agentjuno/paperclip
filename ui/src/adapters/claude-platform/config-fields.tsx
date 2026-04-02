import type { AdapterConfigFieldsProps } from "../types";
import { ClaudeLocalConfigFields } from "../claude-local/config-fields";

export function ClaudePlatformConfigFields(props: AdapterConfigFieldsProps) {
  return (
    <>
      <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Platform-managed billing — API costs are covered by the platform.
      </div>
      <ClaudeLocalConfigFields {...props} />
    </>
  );
}
