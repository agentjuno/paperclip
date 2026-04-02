import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/lib/router";

interface MetricCardProps {
  icon: LucideIcon;
  value: string | number;
  label: string;
  description?: ReactNode;
  to?: string;
  onClick?: () => void;
}

export function MetricCard({ icon: Icon, value, label, description, to, onClick }: MetricCardProps) {
  const isClickable = !!(to || onClick);

  const inner = (
    <div
      className={`paperclip-panel h-full px-4 py-4 sm:px-5 sm:py-5 transition-all${
        isClickable ? " cursor-pointer hover:border-primary/25 hover:bg-accent/25" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">
            {value}
          </p>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground sm:text-sm">
            {label}
          </p>
          {description && (
            <div className="mt-1.5 hidden text-xs text-muted-foreground/75 sm:block">{description}</div>
          )}
        </div>
        <div className="rounded-lg border border-border/70 bg-background/60 p-2.5">
          <Icon className="h-4 w-4 shrink-0 text-primary" />
        </div>
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="no-underline text-inherit h-full" onClick={onClick}>
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <div className="h-full" onClick={onClick}>
        {inner}
      </div>
    );
  }

  return inner;
}
