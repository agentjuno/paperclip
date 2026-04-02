import { cn } from "../lib/utils";
import { statusBadge, statusBadgeDefault } from "../lib/status-colors";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] whitespace-nowrap",
        statusBadge[status] ?? statusBadgeDefault
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}
