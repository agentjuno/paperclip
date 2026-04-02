import { startTransition, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { pickTextColorForPillBg } from "@/lib/color-contrast";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { issuesApi } from "../api/issues";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";
import { formatAssigneeUserLabel } from "../lib/assignees";
import { groupBy } from "../lib/groupBy";
import { formatDate, cn } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { StatusIcon } from "./StatusIcon";
import { PriorityIcon } from "./PriorityIcon";
import { EmptyState } from "./EmptyState";
import { Identity } from "./Identity";
import { IssueRow } from "./IssueRow";
import { PageSkeleton } from "./PageSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { CircleDot, Plus, Filter, ArrowUpDown, Layers, Check, X, ChevronRight, List, Columns3, User, Search } from "lucide-react";
import { KanbanBoard } from "./KanbanBoard";
import type { Issue } from "@paperclipai/shared";

/* ── Helpers ── */

const statusOrder = ["in_progress", "todo", "backlog", "in_review", "blocked", "done", "cancelled"];
const priorityOrder = ["critical", "high", "medium", "low"];

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── View state ── */

export type IssueViewState = {
  statuses: string[];
  priorities: string[];
  assignees: string[];
  labels: string[];
  projects: string[];
  sortField: "status" | "priority" | "title" | "created" | "updated";
  sortDir: "asc" | "desc";
  groupBy: "status" | "priority" | "assignee" | "none";
  viewMode: "list" | "board";
  collapsedGroups: string[];
};

const defaultViewState: IssueViewState = {
  statuses: [],
  priorities: [],
  assignees: [],
  labels: [],
  projects: [],
  sortField: "updated",
  sortDir: "desc",
  groupBy: "none",
  viewMode: "list",
  collapsedGroups: [],
};

const quickFilterPresets = [
  { label: "All", statuses: [] as string[] },
  { label: "Active", statuses: ["todo", "in_progress", "in_review", "blocked"] },
  { label: "Backlog", statuses: ["backlog"] },
  { label: "Done", statuses: ["done", "cancelled"] },
];
const ISSUE_SEARCH_COMMIT_DELAY_MS = 150;

function getViewState(key: string): IssueViewState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...defaultViewState, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...defaultViewState };
}

function saveViewState(key: string, state: IssueViewState) {
  localStorage.setItem(key, JSON.stringify(state));
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function toggleInArray(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function applyFilters(issues: Issue[], state: IssueViewState, currentUserId?: string | null): Issue[] {
  let result = issues;
  if (state.statuses.length > 0) result = result.filter((i) => state.statuses.includes(i.status));
  if (state.priorities.length > 0) result = result.filter((i) => state.priorities.includes(i.priority));
  if (state.assignees.length > 0) {
    result = result.filter((issue) => {
      for (const assignee of state.assignees) {
        if (assignee === "__unassigned" && !issue.assigneeAgentId && !issue.assigneeUserId) return true;
        if (assignee === "__me" && currentUserId && issue.assigneeUserId === currentUserId) return true;
        if (issue.assigneeAgentId === assignee) return true;
      }
      return false;
    });
  }
  if (state.labels.length > 0) result = result.filter((i) => (i.labelIds ?? []).some((id) => state.labels.includes(id)));
  if (state.projects.length > 0) result = result.filter((i) => i.projectId != null && state.projects.includes(i.projectId));
  return result;
}

function sortIssues(issues: Issue[], state: IssueViewState): Issue[] {
  const sorted = [...issues];
  const dir = state.sortDir === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    switch (state.sortField) {
      case "status":
        return dir * (statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
      case "priority":
        return dir * (priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority));
      case "title":
        return dir * a.title.localeCompare(b.title);
      case "created":
        return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case "updated":
        return dir * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      default:
        return 0;
    }
  });
  return sorted;
}

function countActiveFilters(state: IssueViewState): number {
  let count = 0;
  if (state.statuses.length > 0) count++;
  if (state.priorities.length > 0) count++;
  if (state.assignees.length > 0) count++;
  if (state.labels.length > 0) count++;
  if (state.projects.length > 0) count++;
  return count;
}

/* ── Component ── */

interface Agent {
  id: string;
  name: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface IssuesListProps {
  issues: Issue[];
  isLoading?: boolean;
  error?: Error | null;
  agents?: Agent[];
  projects?: ProjectOption[];
  liveIssueIds?: Set<string>;
  projectId?: string;
  viewStateKey: string;
  issueLinkState?: unknown;
  initialAssignees?: string[];
  initialSearch?: string;
  searchFilters?: {
    participantAgentId?: string;
  };
  onSearchChange?: (search: string) => void;
  onUpdateIssue: (id: string, data: Record<string, unknown>) => void;
}

interface IssuesSearchInputProps {
  initialValue: string;
  onValueCommitted: (value: string) => void;
}

function IssuesSearchInput({ initialValue, onValueCommitted }: IssuesSearchInputProps) {
  const [value, setValue] = useState(initialValue);
  const onValueCommittedRef = useRef(onValueCommitted);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    onValueCommittedRef.current = onValueCommitted;
  }, [onValueCommitted]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      onValueCommittedRef.current(value);
    }, ISSUE_SEARCH_COMMIT_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [value]);

  return (
    <div className="relative w-full min-w-0 sm:w-64 md:w-80">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/80" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search tasks..."
        className="h-10 rounded-full border-border/70 bg-background/70 pl-9 text-xs shadow-none placeholder:text-muted-foreground/65 focus-visible:border-primary/35 focus-visible:ring-0 sm:text-sm"
        aria-label="Search tasks"
      />
    </div>
  );
}

export function IssuesList({
  issues,
  isLoading,
  error,
  agents,
  projects,
  liveIssueIds,
  projectId,
  viewStateKey,
  issueLinkState,
  initialAssignees,
  initialSearch,
  searchFilters,
  onSearchChange,
  onUpdateIssue,
}: IssuesListProps) {
  const { selectedCompanyId } = useCompany();
  const { openNewIssue } = useDialog();
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;

  // Scope the storage key per company so folding/view state is independent across companies.
  const scopedKey = selectedCompanyId ? `${viewStateKey}:${selectedCompanyId}` : viewStateKey;

  const [viewState, setViewState] = useState<IssueViewState>(() => {
    if (initialAssignees) {
      return { ...defaultViewState, assignees: initialAssignees, statuses: [] };
    }
    return getViewState(scopedKey);
  });
  const [assigneePickerIssueId, setAssigneePickerIssueId] = useState<string | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [issueSearch, setIssueSearch] = useState(initialSearch ?? "");
  const normalizedIssueSearch = issueSearch.trim();

  useEffect(() => {
    setIssueSearch(initialSearch ?? "");
  }, [initialSearch]);

  // Reload view state from localStorage when company changes (scopedKey changes).
  const prevScopedKey = useRef(scopedKey);
  useEffect(() => {
    if (prevScopedKey.current !== scopedKey) {
      prevScopedKey.current = scopedKey;
      setViewState(initialAssignees
        ? { ...defaultViewState, assignees: initialAssignees, statuses: [] }
        : getViewState(scopedKey));
    }
  }, [scopedKey, initialAssignees]);

  const handleIssueSearchCommit = useCallback((nextSearch: string) => {
    startTransition(() => {
      setIssueSearch(nextSearch);
    });
    onSearchChange?.(nextSearch);
  }, [onSearchChange]);

  const updateView = useCallback((patch: Partial<IssueViewState>) => {
    setViewState((prev) => {
      const next = { ...prev, ...patch };
      saveViewState(scopedKey, next);
      return next;
    });
  }, [scopedKey]);

  const { data: searchedIssues = [] } = useQuery({
    queryKey: [
      ...queryKeys.issues.search(selectedCompanyId!, normalizedIssueSearch, projectId),
      searchFilters ?? {},
    ],
    queryFn: () => issuesApi.list(selectedCompanyId!, { q: normalizedIssueSearch, projectId, ...searchFilters }),
    enabled: !!selectedCompanyId && normalizedIssueSearch.length > 0,
    placeholderData: (previousData) => previousData,
  });

  const agentName = useCallback((id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  }, [agents]);

  const filtered = useMemo(() => {
    const sourceIssues = normalizedIssueSearch.length > 0 ? searchedIssues : issues;
    const filteredByControls = applyFilters(sourceIssues, viewState, currentUserId);
    return sortIssues(filteredByControls, viewState);
  }, [issues, searchedIssues, viewState, normalizedIssueSearch, currentUserId]);

  const { data: labels } = useQuery({
    queryKey: queryKeys.issues.labels(selectedCompanyId!),
    queryFn: () => issuesApi.listLabels(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const activeFilterCount = countActiveFilters(viewState);
  const toolbarButtonClass = "h-9 rounded-full border border-border/70 bg-background/70 px-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:border-primary/20 hover:bg-accent/70 hover:text-foreground";
  const popoverClass = "border-border/70 bg-popover/95 text-popover-foreground shadow-[0_24px_60px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.45)]";
  const groupingLabel =
    viewState.groupBy === "none"
      ? "Single queue"
      : `${viewState.groupBy === "assignee" ? "Assignee" : statusLabel(viewState.groupBy)} groups`;
  const sortingLabel = `${statusLabel(viewState.sortField)} ${viewState.sortDir}`;

  const groupedContent = useMemo(() => {
    if (viewState.groupBy === "none") {
      return [{ key: "__all", label: null as string | null, items: filtered }];
    }
    if (viewState.groupBy === "status") {
      const groups = groupBy(filtered, (i) => i.status);
      return statusOrder
        .filter((s) => groups[s]?.length)
        .map((s) => ({ key: s, label: statusLabel(s), items: groups[s]! }));
    }
    if (viewState.groupBy === "priority") {
      const groups = groupBy(filtered, (i) => i.priority);
      return priorityOrder
        .filter((p) => groups[p]?.length)
        .map((p) => ({ key: p, label: statusLabel(p), items: groups[p]! }));
    }
    // assignee
    const groups = groupBy(
      filtered,
      (issue) => issue.assigneeAgentId ?? (issue.assigneeUserId ? `__user:${issue.assigneeUserId}` : "__unassigned"),
    );
    return Object.keys(groups).map((key) => ({
      key,
      label:
        key === "__unassigned"
          ? "Unassigned"
          : key.startsWith("__user:")
            ? (formatAssigneeUserLabel(key.slice("__user:".length), currentUserId) ?? "User")
            : (agentName(key) ?? key.slice(0, 8)),
      items: groups[key]!,
    }));
  }, [filtered, viewState.groupBy, agents, agentName, currentUserId]);

  const newIssueDefaults = (groupKey?: string) => {
    const defaults: Record<string, string> = {};
    if (projectId) defaults.projectId = projectId;
    if (groupKey) {
      if (viewState.groupBy === "status") defaults.status = groupKey;
      else if (viewState.groupBy === "priority") defaults.priority = groupKey;
      else if (viewState.groupBy === "assignee" && groupKey !== "__unassigned") {
        if (groupKey.startsWith("__user:")) defaults.assigneeUserId = groupKey.slice("__user:".length);
        else defaults.assigneeAgentId = groupKey;
      }
    }
    return defaults;
  };

  const assignIssue = (issueId: string, assigneeAgentId: string | null, assigneeUserId: string | null = null) => {
    onUpdateIssue(issueId, { assigneeAgentId, assigneeUserId });
    setAssigneePickerIssueId(null);
    setAssigneeSearch("");
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="paperclip-panel p-2.5 sm:p-3">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <Button
              size="sm"
              variant="outline"
              className="h-10 rounded-full border-primary/30 bg-primary/10 px-4 text-[11px] font-medium uppercase tracking-[0.18em] text-primary hover:border-primary/45 hover:bg-primary/16 hover:text-primary"
              onClick={() => openNewIssue(newIssueDefaults())}
            >
              <Plus className="h-4 w-4 sm:mr-1" />
              <span>New Task</span>
            </Button>
            <IssuesSearchInput
              initialValue={initialSearch ?? ""}
              onValueCommitted={handleIssueSearchCommit}
            />
            </div>
            <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
              <div className="flex min-w-max items-center gap-2">
                {/* View mode toggle */}
                <div className="flex items-center rounded-full border border-border/70 bg-background/60 p-1">
                  <button
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium uppercase tracking-[0.18em] transition-colors",
                      viewState.viewMode === "list"
                        ? "bg-primary/16 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => updateView({ viewMode: "list" })}
                    title="List view"
                  >
                    <List className="h-3.5 w-3.5" />
                    <span>List</span>
                  </button>
                  <button
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium uppercase tracking-[0.18em] transition-colors",
                      viewState.viewMode === "board"
                        ? "bg-primary/16 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => updateView({ viewMode: "board" })}
                    title="Board view"
                  >
                    <Columns3 className="h-3.5 w-3.5" />
                    <span>Board</span>
                  </button>
                </div>

                {/* Filter */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className={cn(toolbarButtonClass, activeFilterCount > 0 && "border-primary/25 bg-primary/10 text-primary hover:border-primary/40 hover:bg-primary/14 hover:text-primary")}>
                      <Filter className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                      <span>{activeFilterCount > 0 ? `Filters ${activeFilterCount}` : "Filters"}</span>
                      {activeFilterCount > 0 && (
                        <X
                          className="hidden h-3 w-3 sm:block"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateView({ statuses: [], priorities: [], assignees: [], labels: [], projects: [] });
                          }}
                        />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className={cn("w-[min(480px,calc(100vw-2rem))] p-0", popoverClass)}>
                    <div className="space-y-3 p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="paperclip-kicker">Filters</p>
                          <p className="mt-1 text-sm text-muted-foreground">Narrow the operating queue without losing context.</p>
                        </div>
                        {activeFilterCount > 0 && (
                          <button
                            className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:border-primary/20 hover:bg-accent/60 hover:text-foreground"
                            onClick={() => updateView({ statuses: [], priorities: [], assignees: [], labels: [], projects: [] })}
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      <div className="paperclip-soft-divider" />

                      {/* Quick filters */}
                      <div className="space-y-2">
                        <span className="paperclip-kicker text-[0.6rem]">Quick Filters</span>
                        <div className="flex flex-wrap gap-1.5">
                          {quickFilterPresets.map((preset) => {
                            const isActive = arraysEqual(viewState.statuses, preset.statuses);
                            return (
                              <button
                                key={preset.label}
                                className={cn(
                                  "rounded-full border px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] transition-colors",
                                  isActive
                                    ? "border-primary/30 bg-primary/12 text-primary"
                                    : "border-border/70 text-muted-foreground hover:border-primary/20 hover:bg-accent/60 hover:text-foreground",
                                )}
                                onClick={() => updateView({ statuses: isActive ? [] : [...preset.statuses] })}
                              >
                                {preset.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Multi-column filter sections */}
                      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-border/70 bg-background/55 p-3">
                          <span className="paperclip-kicker text-[0.6rem]">Status</span>
                          <div className="mt-2 space-y-0.5">
                            {statusOrder.map((s) => (
                              <label key={s} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60">
                                <Checkbox
                                  checked={viewState.statuses.includes(s)}
                                  onCheckedChange={() => updateView({ statuses: toggleInArray(viewState.statuses, s) })}
                                />
                                <StatusIcon status={s} />
                                <span className="text-sm">{statusLabel(s)}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-lg border border-border/70 bg-background/55 p-3">
                            <span className="paperclip-kicker text-[0.6rem]">Priority</span>
                            <div className="mt-2 space-y-0.5">
                              {priorityOrder.map((p) => (
                              <label key={p} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60">
                                  <Checkbox
                                    checked={viewState.priorities.includes(p)}
                                    onCheckedChange={() => updateView({ priorities: toggleInArray(viewState.priorities, p) })}
                                  />
                                  <PriorityIcon priority={p} />
                                  <span className="text-sm">{statusLabel(p)}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-lg border border-border/70 bg-background/55 p-3">
                            <span className="paperclip-kicker text-[0.6rem]">Assignee</span>
                            <div className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
                              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60">
                                <Checkbox
                                  checked={viewState.assignees.includes("__unassigned")}
                                  onCheckedChange={() => updateView({ assignees: toggleInArray(viewState.assignees, "__unassigned") })}
                                />
                                <span className="text-sm">No assignee</span>
                              </label>
                              {currentUserId && (
                                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60">
                                  <Checkbox
                                    checked={viewState.assignees.includes("__me")}
                                    onCheckedChange={() => updateView({ assignees: toggleInArray(viewState.assignees, "__me") })}
                                  />
                                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="text-sm">Me</span>
                                </label>
                              )}
                              {(agents ?? []).map((agent) => (
                                <label key={agent.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60">
                                  <Checkbox
                                    checked={viewState.assignees.includes(agent.id)}
                                    onCheckedChange={() => updateView({ assignees: toggleInArray(viewState.assignees, agent.id) })}
                                  />
                                  <span className="text-sm">{agent.name}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          {labels && labels.length > 0 && (
                            <div className="rounded-lg border border-border/70 bg-background/55 p-3">
                              <span className="paperclip-kicker text-[0.6rem]">Labels</span>
                              <div className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
                                {labels.map((label) => (
                                  <label key={label.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60">
                                    <Checkbox
                                      checked={viewState.labels.includes(label.id)}
                                      onCheckedChange={() => updateView({ labels: toggleInArray(viewState.labels, label.id) })}
                                    />
                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
                                    <span className="text-sm">{label.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}

                          {projects && projects.length > 0 && (
                            <div className="rounded-lg border border-border/70 bg-background/55 p-3">
                              <span className="paperclip-kicker text-[0.6rem]">Project</span>
                              <div className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
                                {projects.map((project) => (
                                  <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60">
                                    <Checkbox
                                      checked={viewState.projects.includes(project.id)}
                                      onCheckedChange={() => updateView({ projects: toggleInArray(viewState.projects, project.id) })}
                                    />
                                    <span className="text-sm">{project.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                {viewState.viewMode === "list" && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className={toolbarButtonClass}>
                        <ArrowUpDown className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                        <span>Sort</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className={cn("w-52 p-0", popoverClass)}>
                      <div className="space-y-0.5 p-2">
                        {([
                          ["status", "Status"],
                          ["priority", "Priority"],
                          ["title", "Title"],
                          ["created", "Created"],
                          ["updated", "Updated"],
                        ] as const).map(([field, label]) => (
                          <button
                            key={field}
                            className={cn(
                              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                              viewState.sortField === field ? "bg-accent/70 text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                            )}
                            onClick={() => {
                              if (viewState.sortField === field) {
                                updateView({ sortDir: viewState.sortDir === "asc" ? "desc" : "asc" });
                              } else {
                                updateView({ sortField: field, sortDir: "asc" });
                              }
                            }}
                          >
                            <span>{label}</span>
                            {viewState.sortField === field && (
                              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                {viewState.sortDir === "asc" ? "Up" : "Down"}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}

                {viewState.viewMode === "list" && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className={toolbarButtonClass}>
                        <Layers className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                        <span>Group</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className={cn("w-44 p-0", popoverClass)}>
                      <div className="space-y-0.5 p-2">
                        {([
                          ["status", "Status"],
                          ["priority", "Priority"],
                          ["assignee", "Assignee"],
                          ["none", "None"],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            className={cn(
                              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                              viewState.groupBy === value ? "bg-accent/70 text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                            )}
                            onClick={() => updateView({ groupBy: value })}
                          >
                            <span>{label}</span>
                            {viewState.groupBy === value && <Check className="h-3.5 w-3.5" />}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2.5">
            <span className="paperclip-kicker text-[0.58rem]">{filtered.length} visible</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">{groupingLabel}</span>
            {viewState.viewMode === "list" ? (
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">{sortingLabel}</span>
            ) : (
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">Drag between lanes</span>
            )}
            {normalizedIssueSearch ? (
              <span className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/85">
                Search {normalizedIssueSearch}
              </span>
            ) : null}
            {activeFilterCount > 0 ? (
              <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
                {activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/65">No filters</span>
            )}
          </div>
        </div>
      </div>

      {isLoading && <PageSkeleton variant="issues-list" />}
      {error && (
        <div className="paperclip-panel border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </div>
      )}

      {!isLoading && filtered.length === 0 && viewState.viewMode === "list" && (
        <EmptyState
          icon={CircleDot}
          message="No tasks match the current filters or search."
          action="Create Task"
          onAction={() => openNewIssue(newIssueDefaults())}
        />
      )}

      {viewState.viewMode === "board" ? (
        <div className="paperclip-panel rounded-[var(--paperclip-radius-shell)] p-3 sm:p-4">
          <KanbanBoard
            issues={filtered}
            agents={agents}
            liveIssueIds={liveIssueIds}
            onUpdateIssue={onUpdateIssue}
          />
        </div>
      ) : (
        groupedContent.map((group) => (
          <Collapsible
            key={group.key}
            open={!viewState.collapsedGroups.includes(group.key)}
            onOpenChange={(open) => {
              updateView({
                collapsedGroups: open
                  ? viewState.collapsedGroups.filter((k) => k !== group.key)
                  : [...viewState.collapsedGroups, group.key],
              });
            }}
          >
            <div className="paperclip-panel rounded-[var(--paperclip-radius-shell)] p-3 sm:p-4">
              {group.label && (
                <div className="mb-3 flex items-center gap-3 px-1">
                  <CollapsibleTrigger className="flex min-w-0 items-center gap-2">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-90" />
                    <span className="paperclip-kicker text-[0.6rem]">{group.label}</span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
                      {group.items.length}
                    </span>
                  </CollapsibleTrigger>
                  <div className="paperclip-soft-divider hidden flex-1 sm:block" />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-auto rounded-full border border-border/70 bg-background/65 text-muted-foreground hover:border-primary/25 hover:bg-primary/10 hover:text-primary"
                    onClick={() => openNewIssue(newIssueDefaults(group.key))}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              )}
              <CollapsibleContent>
                <div className="space-y-2">
                  {group.items.map((issue) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      issueLinkState={issueLinkState}
                      desktopLeadingSpacer
                      mobileLeading={(
                        <span
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <StatusIcon
                            status={issue.status}
                            onChange={(s) => onUpdateIssue(issue.id, { status: s })}
                          />
                        </span>
                      )}
                      desktopMetaLeading={(
                        <>
                          <span
                            className="hidden shrink-0 sm:inline-flex"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          >
                            <StatusIcon
                              status={issue.status}
                              onChange={(s) => onUpdateIssue(issue.id, { status: s })}
                            />
                          </span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {issue.identifier ?? issue.id.slice(0, 8)}
                          </span>
                          {liveIssueIds?.has(issue.id) && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 sm:gap-1.5 sm:px-2">
                              <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-primary opacity-60" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                              </span>
                              <span className="hidden text-[11px] font-medium uppercase tracking-[0.18em] text-primary sm:inline">
                                Live
                              </span>
                            </span>
                          )}
                        </>
                      )}
                      mobileMeta={timeAgo(issue.updatedAt)}
                      desktopTrailing={(
                        <>
                          {(issue.labels ?? []).length > 0 && (
                            <span className="hidden items-center gap-1 overflow-hidden md:flex md:max-w-[240px]">
                              {(issue.labels ?? []).slice(0, 3).map((label) => (
                                <span
                                  key={label.id}
                                  className="inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em]"
                                  style={{
                                    borderColor: label.color,
                                    color: pickTextColorForPillBg(label.color, 0.12),
                                    backgroundColor: `${label.color}1f`,
                                  }}
                                >
                                  {label.name}
                                </span>
                              ))}
                              {(issue.labels ?? []).length > 3 && (
                                <span className="text-[10px] text-muted-foreground">
                                  +{(issue.labels ?? []).length - 3}
                                </span>
                              )}
                            </span>
                          )}
                          <Popover
                            open={assigneePickerIssueId === issue.id}
                            onOpenChange={(open) => {
                              setAssigneePickerIssueId(open ? issue.id : null);
                              if (!open) setAssigneeSearch("");
                            }}
                          >
                            <PopoverTrigger asChild>
                              <button
                                className="flex w-[190px] shrink-0 items-center rounded-full border border-border/70 bg-background/60 px-2.5 py-1.5 transition-colors hover:border-primary/20 hover:bg-accent/60"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                              >
                                {issue.assigneeAgentId && agentName(issue.assigneeAgentId) ? (
                                  <Identity name={agentName(issue.assigneeAgentId)!} size="sm" />
                                ) : issue.assigneeUserId ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs">
                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/35 bg-muted/30">
                                      <User className="h-3 w-3" />
                                    </span>
                                    {formatAssigneeUserLabel(issue.assigneeUserId, currentUserId) ?? "User"}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/35 bg-muted/30">
                                      <User className="h-3 w-3" />
                                    </span>
                                    Assignee
                                  </span>
                                )}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent
                              className={cn("w-56 p-1", popoverClass)}
                              align="end"
                              onClick={(e) => e.stopPropagation()}
                              onPointerDownOutside={() => setAssigneeSearch("")}
                            >
                              <input
                                className="mb-1 w-full rounded-lg border border-border/70 bg-background/65 px-2.5 py-2 text-xs outline-none placeholder:text-muted-foreground/50"
                                placeholder="Search assignees..."
                                value={assigneeSearch}
                                onChange={(e) => setAssigneeSearch(e.target.value)}
                                autoFocus
                              />
                              <div className="max-h-48 overflow-y-auto overscroll-contain">
                                <button
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-accent/60",
                                    !issue.assigneeAgentId && !issue.assigneeUserId && "bg-accent/70",
                                  )}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    assignIssue(issue.id, null, null);
                                  }}
                                >
                                  No assignee
                                </button>
                                {currentUserId && (
                                  <button
                                    className={cn(
                                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60",
                                      issue.assigneeUserId === currentUserId && "bg-accent/70",
                                    )}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      assignIssue(issue.id, null, currentUserId);
                                    }}
                                  >
                                    <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span>Me</span>
                                  </button>
                                )}
                                {(agents ?? [])
                                  .filter((agent) => {
                                    if (!assigneeSearch.trim()) return true;
                                    return agent.name
                                      .toLowerCase()
                                      .includes(assigneeSearch.toLowerCase());
                                  })
                                  .map((agent) => (
                                    <button
                                      key={agent.id}
                                      className={cn(
                                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60",
                                        issue.assigneeAgentId === agent.id && "bg-accent/70",
                                      )}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        assignIssue(issue.id, agent.id, null);
                                      }}
                                    >
                                      <Identity name={agent.name} size="sm" className="min-w-0" />
                                    </button>
                                  ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        </>
                      )}
                      trailingMeta={formatDate(issue.createdAt)}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))
      )}
    </div>
  );
}
