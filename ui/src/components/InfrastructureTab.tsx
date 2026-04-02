import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { StripeProvisionedService } from "@paperclipai/shared";
import { Plus, RefreshCw, RotateCw, Trash2, Server, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { stripeProjectsApi } from "../api/stripe-projects";
import { queryKeys } from "../lib/queryKeys";
import { useToast } from "../context/ToastContext";
import { StatusBadge } from "./StatusBadge";
import { ServiceCatalogDialog } from "./ServiceCatalogDialog";

/* ── Helper ── */

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/* ── Remove confirmation dialog ── */

function RemoveServiceDialog({
  open,
  onOpenChange,
  service,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: StripeProvisionedService | null;
  onConfirm: (serviceId: string) => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !isPending) onOpenChange(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove Service</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove <strong>{service?.providerService}</strong>? This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={() => {
              if (service) onConfirm(service.id);
            }}
          >
            {isPending && <Loader2 className="animate-spin" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Service row ── */

function ServiceRow({
  service,
  onRemove,
  onRotate,
  isRotating: isRotatingProp,
  isRemoving: isRemovingProp,
}: {
  service: StripeProvisionedService;
  onRemove: () => void;
  onRotate: () => void;
  isRotating: boolean;
  isRemoving: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{service.providerService}</span>
          <StatusBadge status={service.status} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          <span>Provider: {service.provider}</span>
          <span>Type: {service.serviceType}</span>
          {service.tier && <span>Tier: {service.tier}</span>}
          <span>Provisioned: {formatDate(service.provisionedAt)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-4">
        <Button
          variant="ghost"
          size="icon-xs"
          title="Rotate credentials"
          onClick={onRotate}
          disabled={isRotatingProp}
        >
          {isRotatingProp ? <Loader2 className="animate-spin" /> : <RotateCw />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="Remove service"
          onClick={onRemove}
          disabled={isRemovingProp}
        >
          {isRemovingProp ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </Button>
      </div>
    </div>
  );
}

/* ── Main Infrastructure tab content ── */

export function InfrastructureTab({
  companyId,
  projectId,
}: {
  companyId: string;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<StripeProvisionedService | null>(null);
  const [rotatingServiceId, setRotatingServiceId] = useState<string | null>(null);

  const {
    data: services,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.stripeProjects.services(companyId, projectId),
    queryFn: () => stripeProjectsApi.listServices(companyId, projectId),
  });

  const syncMutation = useMutation({
    mutationFn: () => stripeProjectsApi.sync(companyId, projectId),
    onSuccess: (result) => {
      pushToast({
        title: "Credentials synced",
        body: `${result.secretsCount} secret${result.secretsCount !== 1 ? "s" : ""} synced`,
        tone: "success",
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(companyId) });
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to sync credentials", body: err.message, tone: "error" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (serviceId: string) =>
      stripeProjectsApi.removeService(companyId, projectId, serviceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stripeProjects.services(companyId, projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.stripeProjects.status(companyId, projectId) });
      pushToast({ title: "Service removed", tone: "success" });
      setRemoveTarget(null);
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to remove service", body: err.message, tone: "error" });
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (serviceId: string) =>
      stripeProjectsApi.rotate(companyId, projectId, serviceId),
    onSuccess: () => {
      pushToast({ title: "Credentials rotated", tone: "success" });
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(companyId) });
      setRotatingServiceId(null);
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to rotate credentials", body: err.message, tone: "error" });
      setRotatingServiceId(null);
    },
  });

  const handleRotate = (serviceId: string) => {
    setRotatingServiceId(serviceId);
    rotateMutation.mutate(serviceId);
  };

  /* ── Loading state ── */
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="animate-spin mr-2 size-4" />
        Loading infrastructure…
      </div>
    );
  }

  /* ── Error state ── */
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        {(error as Error).message}
      </div>
    );
  }

  const hasServices = services && services.length > 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      {hasServices && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus />
            Add Service
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Sync Credentials
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!hasServices && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <Server className="size-8 text-muted-foreground mb-3" />
          <h3 className="text-sm font-medium mb-1">No services provisioned</h3>
          <p className="text-xs text-muted-foreground mb-4 max-w-sm">
            Add infrastructure services like databases, hosting, or auth providers to this project.
          </p>
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus />
            Add Service
          </Button>
        </div>
      )}

      {/* Service list */}
      {hasServices && (
        <div className="space-y-2">
          {services.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              onRemove={() => setRemoveTarget(service)}
              onRotate={() => handleRotate(service.id)}
              isRotating={rotatingServiceId === service.id && rotateMutation.isPending}
              isRemoving={removeTarget?.id === service.id && removeMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <ServiceCatalogDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        companyId={companyId}
        projectId={projectId}
      />
      <RemoveServiceDialog
        open={!!removeTarget}
        onOpenChange={(open) => {
          if (!open && !removeMutation.isPending) setRemoveTarget(null);
        }}
        service={removeTarget}
        onConfirm={(serviceId: string) => removeMutation.mutate(serviceId)}
        isPending={removeMutation.isPending}
      />
    </div>
  );
}
