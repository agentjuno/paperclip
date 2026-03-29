import {
  Bot,
  FolderKanban,
  Inbox,
  CircleDot,
  Target,
  LayoutDashboard,
  DollarSign,
  History,
  ShieldCheck,
  Search,
  SquarePen,
  Network,
  Boxes,
  Repeat,
  Settings,
  FlaskConical,
  Coins,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarAgents } from "./SidebarAgents";
import { CompanySwitcher } from "./CompanySwitcher";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { Button } from "@/components/ui/button";
import { PluginSlotOutlet } from "@/plugins/slots";

export function Sidebar() {
  const { openNewIssue } = useDialog();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const inboxBadge = useInboxBadge(selectedCompanyId);
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });
  const liveRunCount = liveRuns?.length ?? 0;

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  const pluginContext = {
    companyId: selectedCompanyId,
    companyPrefix: selectedCompany?.issuePrefix ?? null,
  };

  return (
    <aside className="flex h-full min-h-0 w-[17rem] flex-col bg-sidebar">
      <div className="border-b border-border/70 px-4 pb-4 pt-5">
        <div
          className="rounded-[var(--paperclip-radius-shell)] border border-border/70 bg-background/35 p-4"
          style={selectedCompany?.brandColor ? { boxShadow: `0 18px 42px color-mix(in oklab, ${selectedCompany.brandColor} 10%, transparent)` } : undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="paperclip-kicker">Juno OS</p>
              <div className="mt-3 flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: selectedCompany?.brandColor ?? "var(--primary)" }}
                />
                <h2 className="truncate text-base font-semibold text-foreground">
                  {selectedCompany?.name ?? "Select company"}
                </h2>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={openSearch}
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-4">
            <CompanySwitcher />
          </div>
        </div>

        <button
          onClick={() => openNewIssue()}
          className="mt-3 flex w-full items-center gap-3 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2.5 text-[13px] font-medium text-foreground transition-all hover:border-primary/35 hover:bg-primary/14"
        >
          <SquarePen className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">New task</span>
        </button>
      </div>

      <nav className="scrollbar-auto-hide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-1">
          <SidebarNavItem to="/command-center" label="Command Center" icon={LayoutDashboard} liveCount={liveRunCount} />
          <SidebarNavItem
            to="/inbox"
            label="Inbox"
            icon={Inbox}
            badge={inboxBadge.inbox}
            badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
            alert={inboxBadge.failedRuns > 0}
          />
          <PluginSlotOutlet
            slotTypes={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-1"
            itemClassName="text-[13px] font-medium"
            missingBehavior="placeholder"
          />
        </div>

        <SidebarSection label="Build">
          <SidebarNavItem to="/issues" label="Tasks" icon={CircleDot} />
          <SidebarNavItem to="/projects" label="Projects" icon={FolderKanban} />
          <SidebarNavItem to="/goals" label="Goals" icon={Target} />
        </SidebarSection>

        <SidebarProjects />

        <SidebarSection label="Operate">
          <SidebarNavItem to="/agents/all" label="Virtual Office" icon={Bot} />
          <SidebarNavItem to="/routines" label="Automation" icon={Repeat} textBadge="Beta" textBadgeTone="amber" />
          <SidebarNavItem to="/activity" label="Monitoring" icon={History} />
        </SidebarSection>

        <SidebarAgents />

        <SidebarSection label="Knowledge">
          <SidebarNavItem to="/skills" label="Research" icon={Boxes} />
          <SidebarNavItem to="/simulations" label="Simulations" icon={FlaskConical} />
        </SidebarSection>

        <SidebarSection label="Governance">
          <SidebarNavItem to="/approvals/pending" label="Compliance" icon={ShieldCheck} />
          <SidebarNavItem to="/token-launch" label="Token Launch" icon={Coins} />
          <SidebarNavItem to="/costs" label="Costs" icon={DollarSign} />
          <SidebarNavItem to="/org" label="Org" icon={Network} />
          <SidebarNavItem to="/company/settings" label="Settings" icon={Settings} />
        </SidebarSection>

        <PluginSlotOutlet
          slotTypes={["sidebarPanel"]}
          context={pluginContext}
          className="flex flex-col gap-3"
          itemClassName="paperclip-panel p-3"
          missingBehavior="placeholder"
        />
      </nav>
    </aside>
  );
}
