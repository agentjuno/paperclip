import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { StripeCatalogService } from "@paperclipai/shared";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

/* ── Category filter pill ── */

function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/* ── Service catalog item ── */

function CatalogServiceItem({
  service,
  selected,
  onSelect,
}: {
  service: StripeCatalogService;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-md px-3 py-2.5 text-sm transition-colors ${
        selected
          ? "bg-accent text-accent-foreground ring-1 ring-primary/30"
          : "hover:bg-accent/50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{service.name}</span>
        <Badge variant="secondary" className="text-[10px] shrink-0">
          {service.category}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        {service.provider} · {service.category}
      </div>
      {service.description && (
        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {service.description}
        </div>
      )}
    </button>
  );
}

/* ── Main dialog ── */

export function ServiceCatalogDialog({
  open,
  onOpenChange,
  companyId,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [selectedService, setSelectedService] = useState<StripeCatalogService | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  /* Fetch catalog (no server-side category filter — filter locally for snappier UX) */
  const { data: catalog, isLoading: catalogLoading } = useQuery({
    queryKey: queryKeys.stripeProjects.catalog(companyId),
    queryFn: () => stripeProjectsApi.catalog(companyId),
    enabled: open,
  });

  /* Add service mutation */
  const addMutation = useMutation({
    mutationFn: (providerService: string) =>
      stripeProjectsApi.addService(companyId, projectId, providerService),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.stripeProjects.services(companyId, projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.stripeProjects.status(companyId, projectId),
      });
      pushToast({ title: "Service added successfully", tone: "success" });
      handleClose();
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to add service", body: err.message, tone: "error" });
    },
  });

  /* Derive unique categories */
  const categories = Array.from(
    new Set((catalog ?? []).map((s) => s.category).filter(Boolean)),
  ).sort();

  /* Apply client-side filtering */
  const filteredCatalog = (catalog ?? []).filter((service) => {
    if (categoryFilter && service.category !== categoryFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        service.name.toLowerCase().includes(q) ||
        service.provider.toLowerCase().includes(q) ||
        service.category.toLowerCase().includes(q) ||
        (service.description?.toLowerCase().includes(q) ?? false)
      );
    }
    return true;
  });

  function handleClose() {
    setSelectedService(null);
    setCategoryFilter("");
    setSearchQuery("");
    onOpenChange(false);
  }

  function handleConfirm() {
    if (selectedService) {
      addMutation.mutate(selectedService.id);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
        else onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Service</DialogTitle>
          <DialogDescription>
            Browse the service catalog and select a service to provision.
          </DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search services…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-transparent py-1.5 pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Category filter pills */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <CategoryPill
              label="All"
              active={categoryFilter === ""}
              onClick={() => setCategoryFilter("")}
            />
            {categories.map((cat) => (
              <CategoryPill
                key={cat}
                label={cat}
                active={categoryFilter === cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? "" : cat)}
              />
            ))}
          </div>
        )}

        {/* Catalog list */}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {catalogLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="animate-spin mr-2 size-4" />
              Loading catalog…
            </div>
          ) : filteredCatalog.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {searchQuery || categoryFilter
                ? "No services match the current filters."
                : "No services available."}
            </p>
          ) : (
            filteredCatalog.map((service) => (
              <CatalogServiceItem
                key={service.id}
                service={service}
                selected={selectedService?.id === service.id}
                onSelect={() => setSelectedService(service)}
              />
            ))
          )}
        </div>

        {/* Selected service summary */}
        {selectedService && (
          <div className="rounded-md border border-border bg-accent/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Selected: </span>
            <span className="font-medium">{selectedService.name}</span>
            <span className="text-muted-foreground"> ({selectedService.provider})</span>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            size="sm"
            disabled={!selectedService || addMutation.isPending}
            onClick={handleConfirm}
          >
            {addMutation.isPending && <Loader2 className="animate-spin" />}
            Add Service
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
