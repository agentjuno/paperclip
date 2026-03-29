import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
  action?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, message, action, onAction }: EmptyStateProps) {
  return (
    <div className="paperclip-panel mx-auto flex max-w-xl flex-col items-center justify-center rounded-[28px] px-8 py-16 text-center">
      <div className="mb-5 rounded-full border border-border/70 bg-background/45 p-5">
        <Icon className="h-10 w-10 text-primary/75" />
      </div>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">{message}</p>
      {action && onAction && (
        <Button onClick={onAction} className="mt-6">
          <Plus className="h-4 w-4 mr-1.5" />
          {action}
        </Button>
      )}
    </div>
  );
}
