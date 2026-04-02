import { Link } from "@/lib/router";
import { Menu, Wallet } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useSidebar } from "../context/SidebarContext";
import { useCompany } from "../context/CompanyContext";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Fragment, useMemo } from "react";
import { PluginSlotOutlet, usePluginSlots } from "@/plugins/slots";
import { PluginLauncherOutlet, usePluginLaunchers } from "@/plugins/launchers";

type GlobalToolbarContext = { companyId: string | null; companyPrefix: string | null };

function GlobalToolbarPlugins({ context }: { context: GlobalToolbarContext }) {
  const { slots } = usePluginSlots({ slotTypes: ["globalToolbarButton"], companyId: context.companyId });
  const { launchers } = usePluginLaunchers({ placementZones: ["globalToolbarButton"], companyId: context.companyId, enabled: !!context.companyId });
  if (slots.length === 0 && launchers.length === 0) return null;
  return (
    <div className="flex items-center gap-1 shrink-0">
      <PluginSlotOutlet slotTypes={["globalToolbarButton"]} context={context} className="flex items-center gap-1" />
      <PluginLauncherOutlet placementZones={["globalToolbarButton"]} context={context} className="flex items-center gap-1" />
    </div>
  );
}

function TopNavControls({ context }: { context: GlobalToolbarContext }) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2 pl-3">
      <div className="hidden h-9 items-center gap-2 rounded-lg border border-border/70 bg-background/55 px-3.5 lg:inline-flex">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Logged in as</span>
        <span className="text-sm font-medium text-foreground">Tom Osman</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        asChild
        className="hidden h-9 rounded-lg border-border/70 bg-background/45 px-3.5 text-foreground hover:bg-accent/30 lg:inline-flex"
      >
        <Link to="/costs">
          <Wallet className="h-3.5 w-3.5" />
          <span>View Wallet</span>
        </Link>
      </Button>
      <GlobalToolbarPlugins context={context} />
    </div>
  );
}

export function BreadcrumbBar() {
  const { breadcrumbs } = useBreadcrumbs();
  const { toggleSidebar, isMobile } = useSidebar();
  const { selectedCompanyId, selectedCompany } = useCompany();

  const globalToolbarSlotContext = useMemo(
    () => ({
      companyId: selectedCompanyId ?? null,
      companyPrefix: selectedCompany?.issuePrefix ?? null,
    }),
    [selectedCompanyId, selectedCompany?.issuePrefix],
  );

  const topNavControls = <TopNavControls context={globalToolbarSlotContext} />;
  const activeTitle = breadcrumbs[breadcrumbs.length - 1]?.label ?? "Paperclip";
  const companyBadge = selectedCompany ? (
    <span className="inline-flex items-center rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
      {selectedCompany.issuePrefix}
    </span>
  ) : null;

  if (breadcrumbs.length === 0) {
    return (
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border/70 bg-background/80 px-4 py-3 backdrop-blur-xl md:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
            {companyBadge}
            <span className="truncate">{selectedCompany?.name ?? "Paperclip"}</span>
          </div>
          <h1 className="mt-1 truncate text-lg font-semibold tracking-tight">{activeTitle}</h1>
        </div>
        {topNavControls}
      </div>
    );
  }

  const menuButton = isMobile && (
    <Button
      variant="ghost"
      size="icon-sm"
      className="mr-2 shrink-0"
      onClick={toggleSidebar}
      aria-label="Open sidebar"
    >
      <Menu className="h-5 w-5" />
    </Button>
  );

  // Single breadcrumb = title page
  if (breadcrumbs.length === 1) {
    return (
      <div className="flex shrink-0 items-center gap-3 border-b border-border/70 bg-background/80 px-4 py-3 backdrop-blur-xl md:px-6">
        {menuButton}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
            {companyBadge}
            <span className="truncate">{selectedCompany?.name ?? "Paperclip"}</span>
          </div>
          <h1 className="mt-1 truncate text-lg font-semibold tracking-tight">
            {breadcrumbs[0].label}
          </h1>
        </div>
        {topNavControls}
      </div>
    );
  }

  // Multiple breadcrumbs = breadcrumb trail
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border/70 bg-background/80 px-4 py-3 backdrop-blur-xl md:px-6">
      {menuButton}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
          {companyBadge}
          <span className="truncate">{selectedCompany?.name ?? "Paperclip"}</span>
        </div>
        <Breadcrumb className="mt-1 min-w-0 overflow-hidden">
          <BreadcrumbList className="flex-nowrap">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1;
              return (
                <Fragment key={i}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem className={isLast ? "min-w-0" : "shrink-0"}>
                    {isLast || !crumb.href ? (
                      <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link to={crumb.href}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="mt-1 truncate text-lg font-semibold tracking-tight">{activeTitle}</h1>
      </div>
      {topNavControls}
    </div>
  );
}
