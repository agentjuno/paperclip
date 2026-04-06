import { type ChangeEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentMailAttachmentInput,
  AgentMailCollectionResponse,
  AgentMailDraft,
  AgentMailInbox,
  AgentMailList,
  AgentMailMessage,
  AgentMailRecord,
  CompanyMailMessageForward,
  CompanyMailMessageReply,
  CompanyMailMessageSend,
  CompanyMailMessageUpdate,
  CreateCompanyMailApiKey,
  CreateCompanyMailDomain,
  CreateCompanyMailDraft,
  CreateCompanyMailList,
  CreateCompanyMailListEntry,
  CreateCompanyMailWebhook,
  UpdateCompanyMailDraft,
} from "@paperclipai/shared";
import {
  type LucideIcon,
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlertTriangle,
  Bold,
  ChevronDown,
  ChevronRight,
  Download,
  Forward,
  Globe,
  Inbox,
  Italic,
  KeyRound,
  List,
  ListOrdered,
  Mail as MailIcon,
  Maximize2,
  Minimize2,
  Minus,
  Paperclip,
  Plus,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Server,
  ShieldCheck,
  Tags,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import { agentMailApi } from "../api/agentMail";
import { PageSkeleton } from "../components/PageSkeleton";
import { Field } from "../components/agent-config-primitives";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import {
  applyMailLabelMutation,
  buildAgentMailSubject,
  isOutboundMailMessage,
  isUnreadMailMessage,
  splitAgentMailList,
} from "../lib/agentmail";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatDateTime } from "../lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type MailTab = "inbox" | "outbox" | "inboxes" | "domains" | "labels" | "access" | "protocols";
type ComposerMode = "send" | "reply" | "reply_all" | "forward" | "draft";
type ComposerWindowMode = "docked" | "expanded" | "minimized";

type ComposerState = {
  mode: ComposerMode;
  inboxId: string | null;
  to: string;
  cc: string;
  bcc: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  attachments: AgentMailAttachmentInput[];
  sourceMessageId: string | null;
  sourceInboxId: string | null;
  draftId: string | null;
};

const MAIL_TABS: Array<{ value: MailTab; label: string; description: string; icon: LucideIcon }> = [
  { value: "inbox", label: "Inbox", description: "Incoming mail and reading pane", icon: Inbox },
  { value: "outbox", label: "Outbox", description: "Drafts, sent mail, and composer", icon: Send },
  { value: "inboxes", label: "Addresses", description: "Mailbox roster and shared addresses", icon: MailIcon },
  { value: "labels", label: "Filters", description: "Labels, safe senders, and blocked senders", icon: Tags },
];

function emptyComposer(inboxId: string | null): ComposerState {
  return {
    mode: "send",
    inboxId,
    to: "",
    cc: "",
    bcc: "",
    replyTo: "",
    subject: "",
    text: "",
    html: "",
    attachments: [],
    sourceMessageId: null,
    sourceInboxId: null,
    draftId: null,
  };
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown) {
  const next = readString(value).trim();
  return next.length > 0 ? next : null;
}

function readStringByKeys(record: AgentMailRecord | null | undefined, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = readNullableString(record[key]);
    if (value) return value;
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function readRecordArray(value: unknown): AgentMailRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is AgentMailRecord => typeof entry === "object" && entry !== null && !Array.isArray(entry));
}

function uniqueRecipients(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(value.trim());
  }
  return next;
}

function timestampFor(record: AgentMailRecord | null | undefined) {
  return (
    readStringByKeys(record, ["timestamp", "created_at", "updated_at", "received_at", "sent_at"]) ??
    null
  );
}

function formatDateValue(value: unknown) {
  if (!value) return "—";
  if (value instanceof Date) return formatDateTime(value.toISOString());
  if (typeof value === "string") return formatDateTime(value);
  return "—";
}

function inboxIdFor(inbox: AgentMailInbox | null | undefined) {
  return readStringByKeys(inbox ?? null, ["inbox_id", "id"]);
}

function draftIdFor(draft: AgentMailDraft | null | undefined) {
  return readStringByKeys(draft ?? null, ["draft_id", "id"]);
}

function messageIdFor(message: AgentMailMessage | null | undefined) {
  return readStringByKeys(message ?? null, ["message_id", "id"]);
}

function threadIdFor(record: AgentMailRecord | null | undefined) {
  return readStringByKeys(record ?? null, ["thread_id", "id"]);
}

function domainIdFor(domain: AgentMailRecord | null | undefined) {
  return readStringByKeys(domain ?? null, ["domain_id", "id"]);
}

function listIdFor(list: AgentMailList | null | undefined) {
  return readStringByKeys(list ?? null, ["list_id", "id"]);
}

function entryIdFor(entry: AgentMailRecord | null | undefined) {
  return readStringByKeys(entry ?? null, ["entry_id", "id", "value"]);
}

function apiKeyIdFor(record: AgentMailRecord | null | undefined) {
  return readStringByKeys(record ?? null, ["api_key_id", "id"]);
}

function webhookIdFor(record: AgentMailRecord | null | undefined) {
  return readStringByKeys(record ?? null, ["webhook_id", "id"]);
}

function messagePreview(message: AgentMailMessage) {
  return (
    readStringByKeys(message, ["preview", "snippet", "text", "subject"]) ??
    "No preview available."
  );
}

function messageSubject(message: AgentMailMessage) {
  return readStringByKeys(message, ["subject"]) ?? "(no subject)";
}

function recordName(record: AgentMailRecord | null | undefined, fallback: string) {
  return readStringByKeys(record ?? null, ["name", "domain", "email", "url", "id"]) ?? fallback;
}

function formatMailFilterType(value: string | null | undefined) {
  if (value === "allowlist") return "Allowed senders";
  if (value === "blocklist") return "Blocked senders";
  return "Filter";
}

function formatMailFilterDirection(value: string | null | undefined) {
  if (value === "inbound") return "Incoming";
  if (value === "outbound") return "Outgoing";
  if (value === "both") return "All mail";
  return "Incoming";
}

function normalizeMailSearchTerm(value: string) {
  return value.trim().toLowerCase();
}

function matchesMailSearch(value: unknown, term: string): boolean {
  if (!term) return true;
  if (typeof value === "string") return value.toLowerCase().includes(term);
  if (Array.isArray(value)) return value.some((entry) => matchesMailSearch(entry, term));
  return false;
}

function formatMailListTimestamp(value: unknown) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();

  if (sameDay) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function mailboxLabel(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return "Unknown";
  const namedMatch = raw.match(/^([^<]+)</);
  if (namedMatch?.[1]?.trim()) return namedMatch[1].trim();
  const emailMatch = raw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (emailMatch?.[1]) return emailMatch[1];
  return raw;
}

function mailboxAddress(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  const emailMatch = raw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (emailMatch?.[1]) return emailMatch[1];
  return raw.includes("@") ? raw : null;
}

function mailboxAddressParts(value: string | null | undefined) {
  const address = mailboxAddress(value);
  if (!address) {
    return {
      address: null,
      localPart: null,
      domain: null,
    };
  }

  const [localPart, ...domainParts] = address.split("@");
  return {
    address,
    localPart: localPart || address,
    domain: domainParts.join("@") || null,
  };
}

function titleizeMailboxLocalPart(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return "";
  return raw
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mailboxDisplayName(
  name: string | null | undefined,
  value: string | null | undefined,
  fallback = "Mailbox",
  preferAddressWhenUnnamed = false,
) {
  const trimmedName = name?.trim() ?? "";
  if (trimmedName) return trimmedName;

  const label = mailboxLabel(value);
  const address = mailboxAddress(value);
  if (label && address && label !== address) return label;
  if (preferAddressWhenUnnamed && address) return address;

  const titledLocalPart = titleizeMailboxLocalPart(mailboxAddressParts(value).localPart);
  if (titledLocalPart) return titledLocalPart;
  if (address) return address;
  return fallback;
}

function mailboxInitials(value: string | null | undefined) {
  const label = mailboxLabel(value).replace(/["']/g, "").trim();
  if (!label) return "?";
  const parts = label.split(/[\s@._-]+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return initials || label.slice(0, 2).toUpperCase();
}

function sameMailboxAddress(a: string | null | undefined, b: string | null | undefined) {
  const left = mailboxAddress(a)?.toLowerCase() ?? null;
  const right = mailboxAddress(b)?.toLowerCase() ?? null;
  return Boolean(left) && left === right;
}

function participantDisplay(values: string[], currentInboxEmail: string | null | undefined, fallback = "Conversation") {
  const filtered = uniqueRecipients(
    values.filter((value) => !sameMailboxAddress(value, currentInboxEmail)).map((value) => mailboxLabel(value)),
  );
  if (filtered.length === 0) return fallback;
  if (filtered.length === 1) return filtered[0] ?? fallback;
  return `${filtered[0]} +${filtered.length - 1}`;
}

function threadMessageCount(thread: AgentMailRecord | null | undefined) {
  const raw = thread?.message_count;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function toAttachmentRecordList(message: AgentMailMessage | null | undefined) {
  return readRecordArray(message?.attachments);
}

function MailboxIdentity({
  email,
  name,
  fallbackName = "Mailbox",
  preferAddressWhenUnnamed = false,
  className,
  nameClassName,
  addressClassName,
}: {
  email: string | null | undefined;
  name?: string | null;
  fallbackName?: string;
  preferAddressWhenUnnamed?: boolean;
  className?: string;
  nameClassName?: string;
  addressClassName?: string;
}) {
  const { address, localPart, domain } = mailboxAddressParts(email);
  const displayName = mailboxDisplayName(name, email, fallbackName, preferAddressWhenUnnamed);
  const showAddressLine = Boolean(address) && displayName !== address;

  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn("truncate text-sm font-medium text-foreground", nameClassName)}>
        {displayName}
      </div>
      {showAddressLine ? (
        <div className={cn("mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground", addressClassName)}>
          <span className="truncate">{localPart}</span>
          {domain ? <span className="shrink-0 text-muted-foreground/55">@</span> : null}
          {domain ? <span className="truncate text-muted-foreground/85">{domain}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function InlineMailboxIdentity({
  email,
  name,
  fallbackName = "Mailbox",
  preferAddressWhenUnnamed = false,
  className,
}: {
  email: string | null | undefined;
  name?: string | null;
  fallbackName?: string;
  preferAddressWhenUnnamed?: boolean;
  className?: string;
}) {
  const address = mailboxAddress(email);
  const displayName = mailboxDisplayName(name, email, fallbackName, preferAddressWhenUnnamed);
  const showAddress = Boolean(address) && displayName !== address;

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
      {showAddress ? <span className="truncate text-xs text-muted-foreground">{address}</span> : null}
    </div>
  );
}

function MailAddressList({
  values,
  empty = "—",
}: {
  values: string[];
  empty?: string;
}) {
  if (values.length === 0) return <span>{empty}</span>;

  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => {
        const address = mailboxAddress(value) ?? value;
        const displayName = mailboxDisplayName(null, value, address, true);
        const showAddress = address !== displayName;
        return (
          <span
            key={`${displayName}-${address}`}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs"
          >
            <span className="truncate font-medium text-foreground">{displayName}</span>
            {showAddress ? <span className="truncate text-muted-foreground">{address}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function escapeMailHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function plainTextToComposerHtml(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trimEnd();
  if (!normalized.trim()) return "";
  return normalized
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `<div>${escapeMailHtml(line)}</div>` : "<div><br></div>"))
    .join("");
}

function sanitizeComposerHtml(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (typeof document === "undefined") return trimmed;

  const template = document.createElement("template");
  template.innerHTML = trimmed;
  template.content.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((node) => node.remove());
  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const rawValue = attribute.value;
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(rawValue)) {
        element.removeAttribute(attribute.name);
      }
    }
  });

  return template.innerHTML.trim();
}

function htmlToPlainText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (typeof document !== "undefined") {
    const container = document.createElement("div");
    container.innerHTML = trimmed;
    return (container.innerText || container.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return trimmed
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|blockquote|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeComposerHtml(value: string) {
  const sanitized = sanitizeComposerHtml(value);
  return htmlToPlainText(sanitized).length > 0 ? sanitized : "";
}

function composerRowClasses(active = false) {
  return cn(
    "group/compose-row relative transition-[background-color,color,box-shadow] duration-150",
    "hover:bg-muted/[0.08] focus-within:bg-muted/[0.12]",
    active && "bg-muted/[0.12]",
  );
}

type RichMailEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
};

function RichMailEditor({ value, onChange, placeholder = "Write your message" }: RichMailEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const normalizedValue = useMemo(() => normalizeComposerHtml(value), [value]);
  const isEmpty = htmlToPlainText(normalizedValue).length === 0;

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.innerHTML !== normalizedValue) {
      editor.innerHTML = normalizedValue;
    }
  }, [normalizedValue]);

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) return;
    const next = normalizeComposerHtml(editor.innerHTML);
    if (editor.innerHTML !== next) {
      editor.innerHTML = next;
    }
    onChange(next);
  }

  function runCommand(command: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false);
    emitChange();
  }

  const controls: Array<{ label: string; command: string; icon: LucideIcon }> = [
    { label: "Bold", command: "bold", icon: Bold },
    { label: "Italic", command: "italic", icon: Italic },
    { label: "Underline", command: "underline", icon: Underline },
    { label: "Bulleted list", command: "insertUnorderedList", icon: List },
    { label: "Numbered list", command: "insertOrderedList", icon: ListOrdered },
    { label: "Align left", command: "justifyLeft", icon: AlignLeft },
    { label: "Align center", command: "justifyCenter", icon: AlignCenter },
    { label: "Align right", command: "justifyRight", icon: AlignRight },
  ];

  return (
    <div className="group/rich-editor flex min-h-[360px] flex-col overflow-hidden rounded-[20px] border border-border/70 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition-[border-color,background-color,box-shadow] duration-150 hover:border-border focus-within:border-primary/30 focus-within:bg-background focus-within:shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_18px_38px_rgba(0,0,0,0.22)]">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b border-border/70 bg-muted/10 px-3 py-2 transition-colors duration-150 group-hover/rich-editor:bg-muted/15 group-focus-within/rich-editor:bg-muted/15">
        {controls.map((control) => {
          const Icon = control.icon;
          return (
            <button
              key={control.command}
              type="button"
              title={control.label}
              aria-label={control.label}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-[color,background-color,border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-border/70 hover:bg-background hover:text-foreground focus-visible:border-border/70 focus-visible:bg-background focus-visible:text-foreground"
              onMouseDown={(event) => {
                event.preventDefault();
                runCommand(control.command);
              }}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
      <div className="relative min-h-0 flex-1">
        {isEmpty && placeholder ? (
          <div className="pointer-events-none absolute left-5 top-5 text-sm text-muted-foreground/70">
            {placeholder}
          </div>
        ) : null}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          className="h-full min-h-[300px] px-5 py-5 text-[15px] leading-7 text-foreground outline-none [overflow-wrap:anywhere] [&_blockquote]:border-l-2 [&_blockquote]:border-border/70 [&_blockquote]:pl-4 [&_div]:min-h-[1.6em] [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
          onInput={emitChange}
          onBlur={emitChange}
        />
      </div>
    </div>
  );
}

function createComposerPayload(composer: ComposerState) {
  const normalizedHtml = normalizeComposerHtml(composer.html);
  const normalizedText = normalizedHtml ? htmlToPlainText(normalizedHtml) : composer.text;
  return {
    to: splitAgentMailList(composer.to),
    cc: splitAgentMailList(composer.cc),
    bcc: splitAgentMailList(composer.bcc),
    replyTo: splitAgentMailList(composer.replyTo),
    subject: optionalText(composer.subject),
    text: optionalText(normalizedText),
    html: optionalText(normalizedHtml),
    attachments: composer.attachments,
  };
}

function hasAdvancedRecipients(composer: Pick<ComposerState, "cc" | "bcc" | "replyTo">) {
  return [composer.cc, composer.bcc, composer.replyTo].some((value) => value.trim().length > 0);
}

function applyDraftToComposer(draft: AgentMailDraft, inboxId: string | null): ComposerState {
  return {
    mode: "draft",
    inboxId,
    to: readStringArray(draft.to).join(", "),
    cc: readStringArray(draft.cc).join(", "),
    bcc: readStringArray(draft.bcc).join(", "),
    replyTo: readStringArray(draft.reply_to).join(", "),
    subject: readStringByKeys(draft, ["subject"]) ?? "",
    text: readStringByKeys(draft, ["text", "preview", "snippet"]) ?? "",
    html: normalizeComposerHtml(readStringByKeys(draft, ["html"]) ?? plainTextToComposerHtml(readStringByKeys(draft, ["text", "preview", "snippet"]) ?? "")),
    attachments: readRecordArray(draft.attachments).map((attachment) => ({
      filename: readStringByKeys(attachment, ["filename"]) ?? "attachment",
      content: readStringByKeys(attachment, ["content", "data"]) ?? "",
      contentType: readStringByKeys(attachment, ["content_type", "contentType"]),
      contentDisposition: readStringByKeys(attachment, ["content_disposition"]) === "inline" ? "inline" : "attachment",
      contentId: readStringByKeys(attachment, ["content_id"]),
    })),
    sourceMessageId: null,
    sourceInboxId: null,
    draftId: draftIdFor(draft),
  };
}

function quoteBody(message: AgentMailMessage) {
  const from = readStringByKeys(message, ["from"]) ?? "Unknown sender";
  const when = timestampFor(message) ?? "unknown time";
  const preview = readStringByKeys(message, ["text", "preview", "snippet"]) ?? "";
  if (!preview) return "";
  const quoted = preview
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\nOn ${when}, ${from} wrote:\n${quoted}`;
}

async function fileToAttachment(file: File): Promise<AgentMailAttachmentInput> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    filename: file.name,
    content: btoa(binary),
    contentType: file.type || null,
    contentDisposition: "attachment",
    contentId: null,
  };
}

async function copyText(value: string) {
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function Mail() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const markReadInFlightRef = useRef<Set<string>>(new Set());

  const [activeTab, setActiveTab] = useState<MailTab>("inbox");
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [messageLabelInput, setMessageLabelInput] = useState("");
  const [mailSearch, setMailSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [issuedApiKey, setIssuedApiKey] = useState<{
    apiKey: string | null;
    apiKeyId: string | null;
    secretName: string | null;
    secretId: string | null;
  } | null>(null);
  const [composer, setComposer] = useState<ComposerState>(() => emptyComposer(null));
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerWindowMode, setComposerWindowMode] = useState<ComposerWindowMode>("docked");
  const [advancedRecipientsOpen, setAdvancedRecipientsOpen] = useState(false);
  const [attachmentDropActive, setAttachmentDropActive] = useState(false);
  const [createDomainForm, setCreateDomainForm] = useState<CreateCompanyMailDomain>({ domain: "" });
  const [createListForm, setCreateListForm] = useState<Omit<CreateCompanyMailList, "inboxId">>({
    name: "",
    direction: "inbound",
    type: "allowlist",
  });
  const [listEntryInputs, setListEntryInputs] = useState<Record<string, string>>({});
  const [apiKeyForm, setApiKeyForm] = useState<CreateCompanyMailApiKey>({
    scope: "pod",
    inboxId: null,
    name: "",
    permissions: [],
    description: null,
    expiresAt: null,
    persistSecret: false,
    secretName: null,
  });
  const [apiKeyPermissionsInput, setApiKeyPermissionsInput] = useState("");
  const [webhookForm, setWebhookForm] = useState<CreateCompanyMailWebhook>({
    url: "",
    description: "",
    eventTypes: [],
  });
  const [webhookEventInput, setWebhookEventInput] = useState("message.received, message.sent, message.delivered, domain.verified");
  const deferredMailSearch = useDeferredValue(mailSearch);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/command-center" },
      { label: "Mail" },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs]);

  const companyId = selectedCompanyId ?? "";
  const statusQuery = useQuery({
    queryKey: queryKeys.mail.status(companyId),
    queryFn: () => agentMailApi.status(companyId),
    enabled: Boolean(selectedCompanyId),
    refetchInterval: (query) =>
      (query.state.data as { provisioningStatus?: string } | undefined)?.provisioningStatus === "setting_up"
        ? 5_000
        : false,
  });

  const status = statusQuery.data;
  const mailReady = status?.provisioningStatus === "ready" && Boolean(status.podId);

  const inboxesQuery = useQuery({
    queryKey: queryKeys.mail.inboxes(companyId),
    queryFn: () => agentMailApi.listInboxes(companyId, { limit: 100 }),
    enabled: Boolean(selectedCompanyId) && mailReady,
    staleTime: 5_000,
  });

  const inboxes = inboxesQuery.data?.items ?? [];
  const selectedInbox =
    inboxes.find((candidate) => inboxIdFor(candidate) === selectedInboxId) ??
    null;

  useEffect(() => {
    if (!mailReady) {
      setSelectedInboxId(null);
      return;
    }
    const preferredInboxId =
      status?.primaryInboxId ??
      inboxIdFor(inboxes[0]) ??
      null;
    if (!selectedInboxId || !inboxes.some((candidate) => inboxIdFor(candidate) === selectedInboxId)) {
      setSelectedInboxId(preferredInboxId);
    }
  }, [inboxes, mailReady, selectedInboxId, status?.primaryInboxId]);

  useEffect(() => {
    setSelectedMessageId(null);
    setSelectedDraftId(null);
    setComposer((current) => {
      if (current.inboxId === selectedInboxId) return current;
      return emptyComposer(selectedInboxId);
    });
  }, [selectedInboxId]);

  useEffect(() => {
    if (apiKeyForm.scope !== "inbox") return;
    setApiKeyForm((current) => ({
      ...current,
      inboxId: current.inboxId ?? selectedInboxId ?? null,
    }));
  }, [apiKeyForm.scope, selectedInboxId]);

  const threadsQuery = useQuery({
    queryKey: queryKeys.mail.threads(companyId, selectedInboxId),
    queryFn: () => agentMailApi.listThreads(companyId, { inboxId: selectedInboxId ?? undefined, limit: 30 }),
    enabled: Boolean(selectedCompanyId) && mailReady && Boolean(selectedInboxId) && activeTab === "inbox",
  });

  const messagesQuery = useQuery({
    queryKey: selectedInboxId ? queryKeys.mail.messages(companyId, selectedInboxId) : ["mail", companyId, "messages", "__pending__"],
    queryFn: () => agentMailApi.listMessages(companyId, selectedInboxId!, { limit: 120 }),
    enabled: Boolean(selectedCompanyId) && mailReady && Boolean(selectedInboxId) && (activeTab === "inbox" || activeTab === "outbox"),
  });

  const draftsQuery = useQuery({
    queryKey: queryKeys.mail.drafts(companyId, selectedInboxId),
    queryFn: () => agentMailApi.listDrafts(companyId, { inboxId: selectedInboxId ?? undefined, limit: 100 }),
    enabled: Boolean(selectedCompanyId) && mailReady && Boolean(selectedInboxId) && activeTab === "outbox",
  });

  const domainsQuery = useQuery({
    queryKey: queryKeys.mail.domains(companyId),
    queryFn: () => agentMailApi.listDomains(companyId, { limit: 100 }),
    enabled: Boolean(selectedCompanyId) && mailReady && activeTab === "domains",
  });

  const listsQuery = useQuery({
    queryKey: selectedInboxId ? queryKeys.mail.lists(companyId, selectedInboxId) : ["mail", companyId, "lists", "__pending__"],
    queryFn: () => agentMailApi.listLists(companyId, selectedInboxId!, { limit: 100 }),
    enabled: Boolean(selectedCompanyId) && mailReady && Boolean(selectedInboxId) && activeTab === "labels",
  });

  const podApiKeysQuery = useQuery({
    queryKey: queryKeys.mail.apiKeys(companyId, "pod"),
    queryFn: () => agentMailApi.listApiKeys(companyId, { scope: "pod" }),
    enabled: Boolean(selectedCompanyId) && mailReady && activeTab === "access",
  });

  const inboxApiKeysQuery = useQuery({
    queryKey: queryKeys.mail.apiKeys(companyId, "inbox", selectedInboxId),
    queryFn: () => agentMailApi.listApiKeys(companyId, { scope: "inbox", inboxId: selectedInboxId }),
    enabled: Boolean(selectedCompanyId) && mailReady && Boolean(selectedInboxId) && activeTab === "access",
  });

  const webhooksQuery = useQuery({
    queryKey: queryKeys.mail.webhooks(companyId),
    queryFn: () => agentMailApi.listWebhooks(companyId),
    enabled: Boolean(selectedCompanyId) && mailReady && activeTab === "access",
  });

  const threads = threadsQuery.data?.items ?? [];
  const threadsById = useMemo(
    () => new Map(threads.map((thread) => {
      const threadId = threadIdFor(thread);
      return [threadId ?? crypto.randomUUID(), thread] as const;
    })),
    [threads],
  );
  const inboundMessages = useMemo(() => {
    const inboxEmail = readStringByKeys(selectedInbox, ["email", "address"]) ?? status?.primaryInboxEmail ?? null;
    return (messagesQuery.data?.items ?? []).filter((message) => !isOutboundMailMessage(message, inboxEmail));
  }, [messagesQuery.data?.items, selectedInbox, status?.primaryInboxEmail]);

  const outboundMessages = useMemo(() => {
    const inboxEmail = readStringByKeys(selectedInbox, ["email", "address"]) ?? status?.primaryInboxEmail ?? null;
    return (messagesQuery.data?.items ?? []).filter((message) => isOutboundMailMessage(message, inboxEmail));
  }, [messagesQuery.data?.items, selectedInbox, status?.primaryInboxEmail]);

  const drafts = draftsQuery.data?.items ?? [];
  const lists = listsQuery.data?.items ?? [];
  const normalizedMailSearch = normalizeMailSearchTerm(deferredMailSearch);
  const filteredInboundMessages = useMemo(
    () =>
      inboundMessages.filter((message) =>
        matchesMailSearch(
          [
            readStringByKeys(message, ["from"]),
            readStringArray(message.to),
            readStringArray(message.cc),
            messageSubject(message),
            messagePreview(message),
            readStringArray(message.labels),
          ],
          normalizedMailSearch,
        )),
    [inboundMessages, normalizedMailSearch],
  );
  const filteredInboundConversations = useMemo(() => {
    const seen = new Set<string>();
    return filteredInboundMessages.flatMap((message) => {
      const threadId = threadIdFor(message) ?? messageIdFor(message);
      if (!threadId || seen.has(threadId)) return [];
      seen.add(threadId);
      return [{
        threadId,
        message,
        thread: threadsById.get(threadId) ?? null,
      }];
    });
  }, [filteredInboundMessages, threadsById]);
  const filteredOutboundMessages = useMemo(
    () =>
      outboundMessages.filter((message) =>
        matchesMailSearch(
          [
            readStringArray(message.to),
            readStringArray(message.cc),
            messageSubject(message),
            messagePreview(message),
            readStringArray(message.labels),
          ],
          normalizedMailSearch,
        )),
    [normalizedMailSearch, outboundMessages],
  );
  const filteredDrafts = useMemo(
    () =>
      drafts.filter((draft) =>
        matchesMailSearch(
          [
            readStringArray(draft.to),
            readStringArray(draft.cc),
            readStringByKeys(draft, ["subject"]),
            readStringByKeys(draft, ["preview", "text"]),
            readStringArray(draft.labels),
          ],
          normalizedMailSearch,
        )),
    [drafts, normalizedMailSearch],
  );
  const filteredInboxes = useMemo(
    () =>
      inboxes.filter((inbox) =>
        matchesMailSearch(
          [
            readStringByKeys(inbox, ["email", "address"]),
            readStringByKeys(inbox, ["name"]),
            readStringByKeys(inbox, ["status"]),
          ],
          normalizedMailSearch,
        )),
    [inboxes, normalizedMailSearch],
  );
  const filteredLists = useMemo(
    () =>
      lists.filter((list) =>
        matchesMailSearch(
          [
            recordName(list, "Untitled filter"),
            readStringByKeys(list, ["type"]),
            readStringByKeys(list, ["direction"]),
            readStringArray(list.entries),
            readRecordArray(list.entries).flatMap((entry) =>
              readStringArray([readStringByKeys(entry, ["value", "email", "domain"])])),
          ],
          normalizedMailSearch,
        )),
    [lists, normalizedMailSearch],
  );

  useEffect(() => {
    if (activeTab !== "inbox") return;
    if (selectedMessageId && filteredInboundConversations.some((row) => messageIdFor(row.message) === selectedMessageId)) return;
    setSelectedMessageId(messageIdFor(filteredInboundConversations[0]?.message) ?? null);
  }, [activeTab, filteredInboundConversations, selectedMessageId]);

  const selectedMessageSummary =
    filteredInboundConversations.find((row) => messageIdFor(row.message) === selectedMessageId)?.message ??
    null;

  const selectedMessageQuery = useQuery({
    queryKey:
      selectedInboxId && selectedMessageId
        ? queryKeys.mail.message(companyId, selectedInboxId, selectedMessageId)
        : ["mail", companyId, "message", "__pending__"],
    queryFn: () => agentMailApi.getMessage(companyId, selectedInboxId!, selectedMessageId!),
    enabled: Boolean(selectedCompanyId) && mailReady && Boolean(selectedInboxId) && Boolean(selectedMessageId),
  });

  const selectedMessage = selectedMessageQuery.data ?? selectedMessageSummary;
  const selectedThreadId = threadIdFor(selectedMessage);
  const selectedThread = (selectedThreadId ? threadsById.get(selectedThreadId) : null) ?? null;
  const selectedConversationMessages = useMemo(() => {
    if (!selectedThreadId) return selectedMessage ? [selectedMessage] : [];
    const items = (messagesQuery.data?.items ?? [])
      .filter((message) => threadIdFor(message) === selectedThreadId)
      .map((message) => {
        if (selectedMessage && messageIdFor(message) === messageIdFor(selectedMessage)) return selectedMessage;
        return message;
      });

    if (items.length === 0) return selectedMessage ? [selectedMessage] : [];

    return [...items].sort((left, right) => {
      const leftTime = new Date(String(timestampFor(left) ?? 0)).getTime();
      const rightTime = new Date(String(timestampFor(right) ?? 0)).getTime();
      return leftTime - rightTime;
    });
  }, [messagesQuery.data?.items, selectedMessage, selectedThreadId]);

  function applyReadStateLocally(inboxId: string, messageId: string) {
    const labelUpdate = { addLabels: ["read"], removeLabels: ["unread"] };

    queryClient.setQueryData<AgentMailCollectionResponse<AgentMailMessage> | undefined>(
      queryKeys.mail.messages(companyId, inboxId),
      (current) => {
        if (!current) return current;
        return {
          ...current,
          items: current.items.map((message) =>
            messageIdFor(message) === messageId ? applyMailLabelMutation(message, labelUpdate) : message),
        };
      },
    );

    queryClient.setQueryData<AgentMailMessage | undefined>(
      queryKeys.mail.message(companyId, inboxId, messageId),
      (current) => (current ? applyMailLabelMutation(current, labelUpdate) : current),
    );
  }

  useEffect(() => {
    if (activeTab !== "inbox") return;
    if (!selectedCompanyId || !selectedInboxId || !selectedMessage) return;

    const messageId = messageIdFor(selectedMessage);
    if (!messageId || !isUnreadMailMessage(selectedMessage)) return;

    const mutationKey = `${selectedInboxId}:${messageId}`;
    if (markReadInFlightRef.current.has(mutationKey)) return;
    markReadInFlightRef.current.add(mutationKey);

    applyReadStateLocally(selectedInboxId, messageId);

    void agentMailApi
      .updateMessage(selectedCompanyId, selectedInboxId, messageId, {
        addLabels: ["read"],
        removeLabels: ["unread"],
      })
      .then((updatedMessage) => {
        queryClient.setQueryData<AgentMailMessage | undefined>(
          queryKeys.mail.message(selectedCompanyId, selectedInboxId, messageId),
          (current) => (current ? { ...current, ...updatedMessage } : updatedMessage),
        );
        queryClient.setQueryData<AgentMailCollectionResponse<AgentMailMessage> | undefined>(
          queryKeys.mail.messages(selectedCompanyId, selectedInboxId),
          (current) => {
            if (!current) return current;
            return {
              ...current,
              items: current.items.map((message) =>
                messageIdFor(message) === messageId ? { ...message, ...updatedMessage } : message),
            };
          },
        );
      })
      .catch(() => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.mail.messages(selectedCompanyId, selectedInboxId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.mail.message(selectedCompanyId, selectedInboxId, messageId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.mail.threads(selectedCompanyId, selectedInboxId) }),
        ]);
      })
      .finally(() => {
        markReadInFlightRef.current.delete(mutationKey);
      });
  }, [activeTab, companyId, queryClient, selectedCompanyId, selectedInboxId, selectedMessage]);

  useEffect(() => {
    setMessageLabelInput(readStringArray(selectedMessage?.labels).join(", "));
  }, [selectedMessage]);

  const selectedDraft =
    drafts.find((draft) => draftIdFor(draft) === selectedDraftId) ??
    null;

  async function invalidateStatusAndCompany() {
    if (!selectedCompanyId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mail.status(selectedCompanyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all }),
    ]);
  }

  async function invalidateInboxSurface() {
    if (!selectedCompanyId) return;
    const currentInboxId = selectedInboxId;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mail.inboxes(selectedCompanyId) }),
      currentInboxId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.mail.messages(selectedCompanyId, currentInboxId) })
        : Promise.resolve(),
      currentInboxId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.mail.threads(selectedCompanyId, currentInboxId) })
        : Promise.resolve(),
      currentInboxId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.mail.drafts(selectedCompanyId, currentInboxId) })
        : Promise.resolve(),
      currentInboxId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.mail.lists(selectedCompanyId, currentInboxId) })
        : Promise.resolve(),
      currentInboxId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.mail.apiKeys(selectedCompanyId, "inbox", currentInboxId) })
        : Promise.resolve(),
    ]);
  }

  async function invalidateAccessSurface() {
    if (!selectedCompanyId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.mail.apiKeys(selectedCompanyId, "pod") }),
      selectedInboxId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.mail.apiKeys(selectedCompanyId, "inbox", selectedInboxId) })
        : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: queryKeys.mail.webhooks(selectedCompanyId) }),
      invalidateStatusAndCompany(),
    ]);
  }

  async function runAction<T>(
    key: string,
    action: () => Promise<T>,
    options: {
      successTitle: string;
      successBody?: string;
      errorTitle?: string;
      invalidate?: Array<() => Promise<void>>;
    },
  ) {
    setPendingAction(key);
    try {
      const result = await action();
      for (const invalidate of options.invalidate ?? []) {
        await invalidate();
      }
      pushToast({
        title: options.successTitle,
        body: options.successBody,
        tone: "success",
      });
      return result;
    } catch (error) {
      pushToast({
        title: options.errorTitle ?? "Mail request failed",
        body: error instanceof Error ? error.message : "Unexpected AgentMail error",
        tone: "error",
      });
      throw error;
    } finally {
      setPendingAction((current) => (current === key ? null : current));
    }
  }

  function openComposerWindow(mode: ComposerWindowMode = "docked") {
    setComposerWindowMode(mode);
    setComposerOpen(true);
  }

  function closeComposerWindow() {
    setComposerOpen(false);
    setComposerWindowMode("docked");
  }

  async function handleProvision() {
    if (!selectedCompanyId) return;
    await runAction(
      "provision",
      () => agentMailApi.provision(selectedCompanyId),
      {
        successTitle: "Mail provisioning started",
        successBody: "The company pod and primary inbox are being reconciled.",
        invalidate: [invalidateStatusAndCompany, invalidateInboxSurface, invalidateAccessSurface],
      },
    );
  }

  function startFreshComposer() {
    setComposer(emptyComposer(selectedInboxId));
    setSelectedDraftId(null);
    setAdvancedRecipientsOpen(false);
    openComposerWindow("docked");
  }

  function openReplyComposer(mode: "reply" | "reply_all" | "forward", message: AgentMailMessage) {
    const inboxEmail = readStringByKeys(selectedInbox, ["email", "address"]) ?? status?.primaryInboxEmail ?? "";
    const originalTo = readStringArray(message.to);
    const originalCc = readStringArray(message.cc);
    const from = readStringByKeys(message, ["from"]) ?? "";
    const to = mode === "reply_all"
      ? uniqueRecipients([from, ...originalTo.filter((entry) => entry.toLowerCase() !== inboxEmail.toLowerCase())]).join(", ")
      : mode === "reply"
        ? from
        : "";
    const cc = mode === "reply_all"
      ? uniqueRecipients(originalCc.filter((entry) => entry.toLowerCase() !== inboxEmail.toLowerCase())).join(", ")
      : "";
    const quotedText = quoteBody(message);
    const nextComposer: ComposerState = {
      mode,
      inboxId: selectedInboxId,
      to,
      cc,
      bcc: "",
      replyTo: "",
      subject: mode === "forward"
        ? buildAgentMailSubject("Fwd", messageSubject(message))
        : buildAgentMailSubject("Re", messageSubject(message)),
      text: quotedText,
      html: plainTextToComposerHtml(quotedText),
      attachments: [],
      sourceMessageId: messageIdFor(message),
      sourceInboxId: selectedInboxId,
      draftId: null,
    };
    setComposer(nextComposer);
    setSelectedDraftId(null);
    setAdvancedRecipientsOpen(hasAdvancedRecipients(nextComposer));
    openComposerWindow("docked");
  }

  async function appendComposerAttachments(files: File[]) {
    if (files.length === 0) return;
    try {
      const nextAttachments = await Promise.all(files.map((file) => fileToAttachment(file)));
      setComposer((current) => ({
        ...current,
        attachments: [...current.attachments, ...nextAttachments],
      }));
    } catch (error) {
      pushToast({
        title: "Attachment upload failed",
        body: error instanceof Error ? error.message : "Failed to read attachment content",
        tone: "error",
      });
    }
  }

  async function handleComposerAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.currentTarget.value = "";
    await appendComposerAttachments(files);
  }

  function removeComposerAttachment(index: number) {
    setComposer((current) => ({
      ...current,
      attachments: current.attachments.filter((_, attachmentIndex) => attachmentIndex !== index),
    }));
  }

  async function handleSaveDraft() {
    const draftInboxId = composer.inboxId ?? selectedInboxId;
    if (!selectedCompanyId || !draftInboxId) return;
    const draftBody = createComposerPayload(composer);
    if (composer.draftId) {
      await runAction(
        "save-draft",
        () =>
          agentMailApi.updateDraft(selectedCompanyId, draftInboxId, composer.draftId!, draftBody as UpdateCompanyMailDraft),
        {
          successTitle: "Draft updated",
          invalidate: [invalidateInboxSurface],
        },
      );
      return;
    }
    const created = await runAction(
      "save-draft",
      () =>
        agentMailApi.createDraft(selectedCompanyId, {
          inboxId: draftInboxId,
          ...draftBody,
        } as CreateCompanyMailDraft),
      {
        successTitle: "Draft saved",
        invalidate: [invalidateInboxSurface],
      },
    );
    const nextDraftId = draftIdFor(created);
    setComposer((current) => ({
      ...current,
      mode: "draft",
      draftId: nextDraftId,
    }));
    setSelectedDraftId(nextDraftId);
  }

  async function handleSendComposer() {
    const composeInboxId = composer.inboxId ?? selectedInboxId;
    if (!selectedCompanyId || !composeInboxId) return;
    const payload = createComposerPayload(composer);
    if (composer.mode === "reply" || composer.mode === "reply_all") {
      if (!composer.sourceMessageId || !composer.sourceInboxId) {
        pushToast({ title: "Reply context missing", body: "Open a message first, then reply from the inbox panel.", tone: "error" });
        return;
      }
      const sourceInboxId = composer.sourceInboxId;
      const sourceMessageId = composer.sourceMessageId;
      await runAction(
        "send-composer",
        () =>
          agentMailApi.replyToMessage(
            selectedCompanyId,
            sourceInboxId,
            sourceMessageId,
            payload as CompanyMailMessageReply,
          ),
        {
          successTitle: composer.mode === "reply_all" ? "Reply-all sent" : "Reply sent",
          invalidate: [invalidateInboxSurface],
        },
      );
    } else if (composer.mode === "forward") {
      if (!composer.sourceMessageId || !composer.sourceInboxId) {
        pushToast({ title: "Forward context missing", body: "Open a message first, then forward it from the inbox panel.", tone: "error" });
        return;
      }
      const sourceInboxId = composer.sourceInboxId;
      const sourceMessageId = composer.sourceMessageId;
      await runAction(
        "send-composer",
        () =>
          agentMailApi.forwardMessage(
            selectedCompanyId,
            sourceInboxId,
            sourceMessageId,
            payload as CompanyMailMessageForward,
          ),
        {
          successTitle: "Message forwarded",
          invalidate: [invalidateInboxSurface],
        },
      );
    } else if (composer.mode === "draft") {
      let draftId = composer.draftId;
      if (draftId) {
        await agentMailApi.updateDraft(
          selectedCompanyId,
          composeInboxId,
          draftId,
          payload as UpdateCompanyMailDraft,
        );
      } else {
        const created = await agentMailApi.createDraft(selectedCompanyId, {
          inboxId: composeInboxId,
          ...payload,
        } as CreateCompanyMailDraft);
        draftId = draftIdFor(created);
      }
      if (!draftId) {
        pushToast({ title: "Draft send failed", body: "AgentMail did not return a draft id to send.", tone: "error" });
        return;
      }
      await runAction(
        "send-composer",
        () => agentMailApi.sendDraft(selectedCompanyId, composeInboxId, draftId!),
        {
          successTitle: "Draft sent",
          invalidate: [invalidateInboxSurface],
        },
      );
    } else {
      await runAction(
        "send-composer",
        () =>
          agentMailApi.sendMessage(selectedCompanyId, {
            inboxId: composeInboxId,
            ...payload,
          } as CompanyMailMessageSend),
        {
          successTitle: "Message sent",
          invalidate: [invalidateInboxSurface],
        },
      );
    }
    setComposer(emptyComposer(selectedInboxId));
    setSelectedDraftId(null);
    closeComposerWindow();
  }

  async function handleDownloadAttachment(message: AgentMailMessage, attachment: AgentMailRecord) {
    if (!selectedCompanyId || !selectedInboxId) return;
    const messageId = messageIdFor(message);
    const attachmentId = entryIdFor(attachment);
    if (!messageId || !attachmentId) return;
    try {
      setPendingAction("download-attachment");
      const payload = await agentMailApi.getAttachment(selectedCompanyId, selectedInboxId, messageId, attachmentId);
      const directUrl = readStringByKeys(payload, ["url", "download_url"]);
      if (directUrl) {
        window.open(directUrl, "_blank", "noopener,noreferrer");
        return;
      }
      const base64Content = readStringByKeys(payload, ["content", "data", "base64"]);
      if (!base64Content) {
        pushToast({
          title: "Attachment unavailable",
          body: "AgentMail did not return downloadable attachment content for this record.",
          tone: "warn",
        });
        return;
      }
      const bytes = decodeBase64(base64Content);
      const filename = readStringByKeys(payload, ["filename"]) ?? readStringByKeys(attachment, ["filename"]) ?? "attachment";
      const contentType = readStringByKeys(payload, ["content_type"]) ?? readStringByKeys(attachment, ["content_type"]) ?? "application/octet-stream";
      const blob = new Blob([bytes], { type: contentType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      pushToast({
        title: "Attachment download failed",
        body: error instanceof Error ? error.message : "Could not fetch attachment from AgentMail",
        tone: "error",
      });
    } finally {
      setPendingAction((current) => (current === "download-attachment" ? null : current));
    }
  }

  if (!selectedCompanyId) {
    return <div className="text-sm text-muted-foreground">No company selected. Choose a company to open Mail.</div>;
  }

  if (!selectedCompany) {
    return <div className="text-sm text-muted-foreground">No company selected. Choose a company to open Mail.</div>;
  }

  if (statusQuery.isLoading && !status) {
    return <PageSkeleton variant="detail" />;
  }

  if (statusQuery.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
        {statusQuery.error instanceof Error ? statusQuery.error.message : "Failed to load company mail status"}
      </div>
    );
  }

  const primaryInboxEmail = status?.primaryInboxEmail ?? selectedCompany.primaryMailInboxEmail ?? null;
  const currentInboxEmail = readStringByKeys(selectedInbox, ["email", "address"]) ?? primaryInboxEmail;
  const currentInboxName =
    readStringByKeys(selectedInbox, ["name"]) ??
    (selectedInboxId === status?.primaryInboxId ? `${selectedCompany.name} Mail` : null);
  const composerInboxId = composer.inboxId ?? selectedInboxId ?? null;
  const composerInbox =
    inboxes.find((candidate) => inboxIdFor(candidate) === composerInboxId) ??
    selectedInbox;
  const composerInboxName =
    readStringByKeys(composerInbox, ["name"]) ??
    (composerInboxId === status?.primaryInboxId ? `${selectedCompany.name} Mail` : null);
  const composerInboxEmail = readStringByKeys(composerInbox, ["email", "address"]) ?? status?.primaryInboxEmail ?? null;
  const podKeys = podApiKeysQuery.data?.items ?? [];
  const inboxKeys = inboxApiKeysQuery.data?.items ?? [];
  const webhooks = webhooksQuery.data?.items ?? [];
  const domains = domainsQuery.data?.items ?? [];
  const recentThreads = (threadsQuery.data?.items ?? []).slice(0, 4);
  const mailboxCount = inboxes.length;
  const draftCount = drafts.length;
  const sentCount = outboundMessages.length;
  const unreadCount = inboundMessages.filter((message) => isUnreadMailMessage(message)).length;
  const provisioningStatus = status?.provisioningStatus ?? selectedCompany.mailProvisioningStatus ?? "not_started";
  const headerDescription = mailReady
    ? "Read incoming mail, send replies, and manage company addresses from a familiar mailbox workspace."
    : "Set up company mail once, then handle incoming messages, drafts, and shared addresses from one place.";
  const composerDialogTitle =
    composer.mode === "reply"
      ? "Reply"
      : composer.mode === "reply_all"
        ? "Reply all"
        : composer.mode === "forward"
          ? "Forward"
          : composer.mode === "draft"
            ? "Edit draft"
            : "New message";
  const composerWindowTitle = composer.subject.trim() || composerDialogTitle;
  const composerWindowSubtitle = composer.to.trim().length > 0 ? `To ${composer.to.trim()}` : null;
  const advancedRecipientCount = [composer.cc, composer.bcc, composer.replyTo].filter((value) => value.trim().length > 0).length;
  const composerAttachmentCount = composer.attachments.length;
  const composerAttachmentBytes = composer.attachments.reduce((total, attachment) => {
    const content = attachment.content ?? "";
    if (!content) return total;
    const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
    return total + Math.max(0, Math.floor((content.length * 3) / 4) - padding);
  }, 0);
  const headerAction = mailReady ? (
    <Button onClick={startFreshComposer}>
      <Send className="h-4 w-4" />
      Compose
    </Button>
  ) : provisioningStatus === "setting_up" ? (
    <Button
      variant="outline"
      onClick={() => {
        void invalidateStatusAndCompany();
        void invalidateInboxSurface();
      }}
      disabled={pendingAction === "refresh"}
    >
      <RefreshCw className="h-4 w-4" />
      Refresh status
    </Button>
  ) : (
    <Button onClick={() => void handleProvision()} disabled={pendingAction === "provision"}>
      <MailIcon className="h-4 w-4" />
      {provisioningStatus === "failed" ? "Repair Mail" : "Set up Mail"}
    </Button>
  );

  return (
    <div className="paperclip-grid w-full max-w-none space-y-6">
      <section className="command-hero-shell command-fade-up px-5 py-5 sm:px-6 lg:px-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="paperclip-kicker flex items-center gap-3">
              <span>Operate / Mail</span>
              <span className="h-px w-8 bg-border/80" />
              <span>{provisioningStatus}</span>
            </div>
            <div className="min-w-0 space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Mail
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                {headerDescription}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{currentInboxEmail ?? primaryInboxEmail ?? `${selectedCompany.name} Mail`}</span>
                <span className="opacity-60">•</span>
                <span>{unreadCount} unread</span>
                <span className="opacity-60">•</span>
                <span>{draftCount} drafts</span>
                <span className="opacity-60">•</span>
                <span>{mailboxCount} {mailboxCount === 1 ? "address" : "addresses"}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {headerAction}
          </div>
        </div>
      </section>

      {!mailReady ? (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="rounded-[24px] border-border/70">
            <CardHeader>
              <CardTitle>Mailbox setup</CardTitle>
              <CardDescription>
                Mail is being prepared for this company. Once setup finishes, the primary address will appear here and
                the mailbox will open like a standard email app.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border/70 bg-muted/25 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Status</div>
                  <div className="mt-2 text-sm font-medium">{status?.provisioningStatus ?? "not_started"}</div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/25 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Primary address</div>
                  {primaryInboxEmail ? (
                    <MailboxIdentity
                      email={primaryInboxEmail}
                      name={`${selectedCompany.name} Mail`}
                      fallbackName={`${selectedCompany.name} Mail`}
                      className="mt-2"
                      nameClassName="text-sm font-medium"
                    />
                  ) : (
                    <div className="mt-2 text-sm font-medium">Generating address</div>
                  )}
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/25 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Next step</div>
                  <div className="mt-2 text-sm font-medium">Open Mail once setup completes</div>
                </div>
              </div>
              {status?.lastError ? (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <div className="font-medium">Setup needs another try</div>
                      <div className="mt-1 text-amber-900/80 dark:text-amber-100/85">
                        The mailbox did not finish setting up automatically. Use Repair Mail to retry in the background.
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-[24px] border-border/70">
            <CardHeader>
              <CardTitle>What happens next</CardTitle>
              <CardDescription>
                Setup continues in the background. The company stays intact even if mail setup needs another retry.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="font-medium text-foreground">1. Create the mailbox</div>
                <div className="mt-1">Your company gets a primary address automatically.</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="font-medium text-foreground">2. Turn on sending and receiving</div>
                <div className="mt-1">Incoming mail, drafts, and sent mail will appear here once syncing is ready.</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="font-medium text-foreground">3. Open your mailbox</div>
                <div className="mt-1">From there you can read mail, draft replies, and manage addresses and filters.</div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
        <Tabs
          orientation="vertical"
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as MailTab)}
          className="grid gap-4 xl:grid-cols-[264px_minmax(320px,0.94fr)_minmax(460px,1.06fr)]"
        >
          <aside className="overflow-hidden rounded-[28px] border border-border/70 bg-gradient-to-b from-muted/[0.22] via-background/80 to-background/95 shadow-sm xl:sticky xl:top-6 xl:self-start">
            <div className="border-b border-border/70 px-4 py-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={mailSearch}
                    onChange={(event) => setMailSearch(event.target.value)}
                    placeholder="Search mail"
                    className="h-12 rounded-2xl border-border/70 bg-background/90 pl-10 shadow-sm transition-[border-color,background-color,box-shadow] hover:border-border hover:bg-background focus-visible:shadow-[0_0_0_1px_rgba(212,175,85,0.25)]"
                  />
                </div>
                <Button
                  variant="outline"
                  className="h-12 w-12 rounded-2xl border-border/70 bg-background/90 px-0 shadow-sm transition-[border-color,background-color,color,transform] hover:border-primary/30 hover:bg-background hover:text-foreground hover:-translate-y-0.5"
                  onClick={() => {
                    void invalidateStatusAndCompany();
                    void invalidateInboxSurface();
                  }}
                  disabled={pendingAction === "refresh"}
                  aria-label="Refresh mail"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="px-3 py-4">
              <div className="px-2 pb-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground/80">Folders</div>
              <TabsList
                variant="line"
                className="h-auto w-full flex-col items-stretch gap-1.5 rounded-[22px] bg-transparent p-0"
              >
                {MAIL_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.value;
                  const tabCount =
                    tab.value === "inbox"
                      ? unreadCount
                      : tab.value === "outbox"
                        ? draftCount
                        : tab.value === "inboxes"
                          ? mailboxCount
                          : filteredLists.length;
                  return (
                    <TabsTrigger
                      key={tab.value}
                      value={tab.value}
                      className={cn(
                        "group rounded-[20px] border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow,transform]",
                        isActive
                          ? "border-primary/30 bg-primary/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_24px_rgba(0,0,0,0.18)]"
                          : "border-transparent hover:border-border/60 hover:bg-background/70 hover:shadow-sm hover:-translate-y-0.5",
                      )}
                    >
                      <div className="flex w-full items-center gap-3">
                        <span
                          className={cn(
                            "h-9 w-1.5 shrink-0 rounded-full transition-colors",
                            isActive ? "bg-primary/80" : "bg-transparent group-hover:bg-primary/25",
                          )}
                        />
                        <Icon
                          className={cn(
                            "h-4 w-4 transition-colors",
                            isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                          )}
                        />
                        <div className={cn("min-w-0 flex-1 text-sm transition-colors", isActive ? "font-semibold text-foreground" : "font-medium text-foreground")}>
                          {tab.label}
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                            isActive
                              ? "border border-primary/30 bg-primary/[0.14] font-medium text-foreground"
                              : "border border-border/60 bg-background/70 text-muted-foreground group-hover:border-border group-hover:bg-background group-hover:text-foreground",
                          )}
                        >
                          {tabCount}
                        </span>
                      </div>
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            <div className="border-t border-border/70 bg-background/40 px-4 py-4">
              <div className="space-y-3.5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground/80">Using</Label>
                    {mailboxCount > 1 ? (
                      <span className="rounded-full border border-border/60 bg-background/65 px-2 py-0.5 text-[11px] text-muted-foreground">
                        {mailboxCount} addresses
                      </span>
                    ) : null}
                  </div>
                  <Select value={selectedInboxId ?? undefined} onValueChange={setSelectedInboxId}>
                    <SelectTrigger className="min-h-[64px] rounded-[22px] border-border/70 bg-background/95 px-4 py-3 shadow-sm transition-[border-color,background-color,box-shadow,transform] hover:border-border hover:bg-background hover:shadow-md hover:-translate-y-0.5 focus:ring-0">
                      {selectedInbox ? (
                        <MailboxIdentity
                          email={currentInboxEmail}
                          name={currentInboxName}
                          fallbackName={`${selectedCompany.name} Mail`}
                          preferAddressWhenUnnamed={selectedInboxId !== status?.primaryInboxId}
                          nameClassName="text-sm font-medium"
                          addressClassName="mt-1 text-[11px]"
                        />
                      ) : (
                        <span className="text-sm text-muted-foreground">Select an inbox</span>
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {inboxes.map((inbox) => {
                        const id = inboxIdFor(inbox);
                        if (!id) return null;
                        const email = readStringByKeys(inbox, ["email", "address"]) ?? "Unnamed inbox";
                        const name =
                          readStringByKeys(inbox, ["name"]) ??
                          (id === status?.primaryInboxId ? `${selectedCompany.name} Mail` : null);
                        return (
                          <SelectItem key={id} value={id}>
                            <MailboxIdentity
                              email={email}
                              name={name}
                              fallbackName={`${selectedCompany.name} Mail`}
                              preferAddressWhenUnnamed={id !== status?.primaryInboxId}
                              nameClassName="text-sm"
                              addressClassName="mt-0.5 text-[11px]"
                            />
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="inline-flex items-center gap-2 text-muted-foreground">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          status?.provisioningStatus === "ready" ? "bg-emerald-400" : "bg-amber-400",
                        )}
                      />
                      <span className="font-medium text-foreground">
                        {status?.provisioningStatus === "ready" ? "Ready to send and receive" : "Mailbox is setting up"}
                      </span>
                    </div>
                    {mailboxCount > 1 ? <span className="text-muted-foreground">{mailboxCount} connected</span> : null}
                  </div>
                  <div className="grid grid-cols-3 overflow-hidden rounded-[20px] border border-border/60 bg-background/65">
                    <div className="px-3 py-2.5">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Unread</div>
                      <div className="mt-1 text-sm font-semibold text-foreground">{unreadCount}</div>
                    </div>
                    <div className="border-l border-border/60 px-3 py-2.5">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Drafts</div>
                      <div className="mt-1 text-sm font-semibold text-foreground">{draftCount}</div>
                    </div>
                    <div className="border-l border-border/60 px-3 py-2.5">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Sent</div>
                      <div className="mt-1 text-sm font-semibold text-foreground">{sentCount}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          <TabsContent value="inbox" className="mt-0 xl:col-span-2">
            <div className="grid overflow-hidden rounded-[28px] border border-border/70 bg-background/85 shadow-sm xl:h-[calc(100vh-12rem)] xl:grid-cols-[minmax(320px,0.92fr)_minmax(460px,1.08fr)]">
              <section className="flex min-h-0 flex-col border-b border-border/70 bg-muted/10 xl:border-b-0 xl:border-r">
                <div className="border-b border-border/70 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Inbox</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {currentInboxEmail ?? "Current inbox"} · {filteredInboundConversations.length} conversations · {unreadCount} unread
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs text-muted-foreground">
                        All mail
                      </span>
                      <span className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs text-muted-foreground">
                        Unread {unreadCount}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {messagesQuery.isLoading || threadsQuery.isLoading ? (
                    <div className="p-4">
                      <PageSkeleton variant="inbox" />
                    </div>
                  ) : filteredInboundConversations.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border/70 bg-background/80">
                        <Inbox className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div className="mt-4 text-base font-medium text-foreground">
                        {mailSearch.trim().length > 0 ? "No conversations match this search" : "Your inbox is quiet"}
                      </div>
                      <div className="mt-2 max-w-xs text-sm text-muted-foreground">
                        {mailSearch.trim().length > 0
                          ? "Try a sender, subject line, or snippet instead."
                          : "New incoming mail will appear here. Drafts and sent mail stay in Outbox."}
                      </div>
                    </div>
                  ) : (
                    <div className="divide-y divide-border/60">
                      {filteredInboundConversations.map(({ message, thread, threadId }) => {
                        const messageId = messageIdFor(message) ?? threadId ?? crypto.randomUUID();
                        const active = messageId === selectedMessageId;
                        const unread = isUnreadMailMessage(message);
                        const sender = participantDisplay(
                          readStringArray(thread?.senders),
                          currentInboxEmail,
                          mailboxLabel(readStringByKeys(message, ["from"])),
                        );
                        const recipientSummary = participantDisplay(
                          readStringArray(thread?.recipients),
                          currentInboxEmail,
                          "Recipients",
                        );
                        const messageCount = threadMessageCount(thread);

                        return (
                          <button
                            key={threadId}
                            type="button"
                            onClick={() => setSelectedMessageId(messageId)}
                            className={cn(
                              "group w-full border-l-2 px-4 py-4 text-left transition-[background-color,border-color,box-shadow,transform]",
                              active
                                ? "border-l-primary/80 bg-primary/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_24px_rgba(0,0,0,0.18)]"
                                : "border-l-transparent hover:border-l-primary/35 hover:bg-accent/35 hover:shadow-sm",
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <div
                                className={cn(
                                  "mt-2 h-2.5 w-2.5 rounded-full transition-colors",
                                  unread
                                    ? active
                                      ? "bg-primary"
                                      : "bg-sky-500"
                                    : active
                                      ? "bg-primary/45"
                                      : "bg-transparent ring-1 ring-border/50",
                                )}
                              />
                              <div
                                className={cn(
                                  "flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold transition-[background-color,color,box-shadow]",
                                  active
                                    ? "bg-primary/[0.14] text-foreground shadow-[inset_0_0_0_1px_rgba(212,175,85,0.28)]"
                                    : "bg-muted/70 text-foreground group-hover:bg-background/90",
                                )}
                              >
                                {mailboxInitials(sender)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div
                                      className={cn(
                                        "truncate text-sm transition-colors",
                                        active ? "font-semibold text-foreground" : unread ? "font-semibold text-foreground" : "font-medium text-foreground",
                                      )}
                                    >
                                      {sender}
                                    </div>
                                    <div className="mt-0.5 flex items-center gap-2">
                                      <div className={cn("truncate text-sm transition-colors", active ? "font-medium text-foreground" : "text-foreground")}>
                                        {readStringByKeys(thread, ["subject"]) ?? messageSubject(message)}
                                      </div>
                                      {messageCount > 1 ? (
                                        <span
                                          className={cn(
                                            "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                                            active
                                              ? "border border-primary/30 bg-primary/[0.14] font-medium text-foreground"
                                              : "border border-border/70 bg-background/80 text-muted-foreground",
                                          )}
                                        >
                                          {messageCount}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className={cn("mt-1 truncate text-xs transition-colors", active ? "text-foreground/75" : "text-muted-foreground")}>
                                      To {recipientSummary}
                                    </div>
                                  </div>
                                  <div className={cn("shrink-0 text-xs transition-colors", active ? "text-foreground/75" : "text-muted-foreground")}>
                                    {formatMailListTimestamp(timestampFor(thread ?? message))}
                                  </div>
                                </div>
                                <div className={cn("mt-2 line-clamp-2 text-sm transition-colors", active ? "text-foreground/80" : "text-muted-foreground")}>
                                  {readStringByKeys(thread, ["preview"]) ?? messagePreview(message)}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {readStringArray(thread?.labels ?? message.labels).slice(0, 2).map((label) => (
                                    <span
                                      key={label}
                                      className={cn(
                                        "rounded-full px-2 py-0.5 text-[11px] transition-colors",
                                        active
                                          ? "border border-primary/25 bg-primary/[0.12] text-foreground/80"
                                          : "border border-border/70 bg-background/80 text-muted-foreground",
                                      )}
                                    >
                                      {label}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>

              <section className="flex min-h-0 flex-col bg-background/80">
                <div className="border-b border-border/70 bg-gradient-to-b from-background via-background/95 to-background/88 px-5 py-5">
                  <div className="flex flex-col gap-4">
                    {selectedMessage ? (
                      <>
                        <div className="flex min-w-0 items-start gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/[0.12] text-sm font-semibold text-foreground shadow-[inset_0_0_0_1px_rgba(212,175,85,0.24)]">
                            {mailboxInitials(readStringByKeys(selectedMessage, ["from"]))}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground/80">Conversation</div>
                            <div className="mt-2 text-[24px] font-semibold leading-tight text-foreground">
                              {readStringByKeys(selectedThread, ["subject"]) ?? messageSubject(selectedMessage)}
                            </div>
                            <div className="mt-2 text-sm text-muted-foreground">
                              {participantDisplay(
                                readStringArray(selectedThread?.senders),
                                currentInboxEmail,
                                mailboxLabel(readStringByKeys(selectedMessage, ["from"])),
                              )}
                              {threadMessageCount(selectedThread) > 1 ? ` · ${threadMessageCount(selectedThread)} messages` : ""}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {formatDateValue(timestampFor(selectedThread ?? selectedMessage))}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 sm:pl-16">
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full border-border/70 bg-background/65 hover:border-primary/25 hover:bg-primary/[0.08]"
                            onClick={() => selectedMessage && openReplyComposer("reply", selectedMessage)}
                            disabled={!selectedMessage}
                          >
                            <Reply className="h-4 w-4" />
                            Reply
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full border-border/70 bg-background/65 hover:border-primary/25 hover:bg-primary/[0.08]"
                            onClick={() => selectedMessage && openReplyComposer("reply_all", selectedMessage)}
                            disabled={!selectedMessage}
                          >
                            <ReplyAll className="h-4 w-4" />
                            Reply all
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full border-border/70 bg-background/65 hover:border-primary/25 hover:bg-primary/[0.08]"
                            onClick={() => selectedMessage && openReplyComposer("forward", selectedMessage)}
                            disabled={!selectedMessage}
                          >
                            <Forward className="h-4 w-4" />
                            Forward
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="min-w-0">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground/80">Reading pane</div>
                        <div className="mt-2 text-lg font-semibold text-foreground">Conversation preview</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Choose a conversation from the center pane to read it here.
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                  {selectedMessageQuery.isLoading && selectedMessageId ? (
                    <div className="p-5">
                      <PageSkeleton variant="detail" />
                    </div>
                  ) : !selectedMessage ? (
                    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border/70 bg-background/80">
                        <MailIcon className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div className="mt-5 text-base font-medium text-foreground">Conversation preview</div>
                      <div className="mt-2 max-w-sm text-sm text-muted-foreground">
                        Choose a conversation from the list to read the thread, labels, and attachments here.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6 px-5 py-5">
                      <div className="rounded-[24px] border border-border/60 bg-background/45 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
                          <div className="space-y-4">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Participants</div>
                              <div className="mt-2">
                                <MailAddressList
                                  values={uniqueRecipients([
                                    ...readStringArray(selectedThread?.senders),
                                    ...readStringArray(selectedThread?.recipients),
                                  ])}
                                />
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="rounded-full border border-border/70 bg-background/70 px-2.5 py-1">
                                {Math.max(threadMessageCount(selectedThread), selectedConversationMessages.length)} messages
                              </span>
                              <span>Latest activity {formatDateValue(timestampFor(selectedThread ?? selectedMessage))}</span>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Labels</div>
                            <div className="flex flex-wrap gap-2">
                              {readStringArray(selectedThread?.labels ?? selectedMessage.labels).length > 0 ? (
                                readStringArray(selectedThread?.labels ?? selectedMessage.labels).map((label) => (
                                  <Badge key={label} variant="outline">{label}</Badge>
                                ))
                              ) : (
                                <Badge variant="outline">No labels</Badge>
                              )}
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <Input
                                value={messageLabelInput}
                                onChange={(event) => setMessageLabelInput(event.target.value)}
                                placeholder="finance, customer, vip"
                                className="h-11 rounded-2xl border-border/70 bg-background/80"
                              />
                              <Button
                                variant="outline"
                                className="rounded-2xl border-border/70 bg-background/80 hover:border-primary/25 hover:bg-primary/[0.08]"
                                onClick={() => {
                                  if (!selectedInboxId || !selectedMessageId) return;
                                  void runAction(
                                    "message-labels",
                                    () =>
                                      agentMailApi.updateMessage(
                                        selectedCompanyId,
                                        selectedInboxId,
                                        selectedMessageId,
                                        { labels: splitAgentMailList(messageLabelInput) } as CompanyMailMessageUpdate,
                                      ),
                                    {
                                      successTitle: "Labels updated",
                                      invalidate: [invalidateInboxSurface],
                                    },
                                  );
                                }}
                                disabled={!selectedMessageId || pendingAction === "message-labels"}
                              >
                                Save labels
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="relative pl-5">
                        <div className="absolute bottom-0 left-[19px] top-1 w-px bg-border/60" />
                        <div className="space-y-4">
                          {selectedConversationMessages.map((message) => {
                            const messageId = messageIdFor(message) ?? crypto.randomUUID();
                            const outbound = isOutboundMailMessage(message, currentInboxEmail);
                            const labels = readStringArray(message.labels);
                            return (
                              <article key={messageId} className={cn("relative pl-6", outbound ? "ml-5" : "")}>
                                <span
                                  className={cn(
                                    "absolute left-[1px] top-5 h-3 w-3 rounded-full ring-4 ring-background",
                                    outbound ? "bg-primary/80" : "bg-muted-foreground/70",
                                  )}
                                />
                                <div
                                  className={cn(
                                    "overflow-hidden rounded-[24px] border shadow-sm",
                                    outbound
                                      ? "border-primary/18 bg-primary/[0.07]"
                                      : "border-border/60 bg-background/72",
                                  )}
                                >
                                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 px-4 py-3">
                                    <div className="flex min-w-0 items-start gap-3">
                                      <div
                                        className={cn(
                                          "flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-foreground",
                                          outbound
                                            ? "bg-primary/[0.14] shadow-[inset_0_0_0_1px_rgba(212,175,85,0.24)]"
                                            : "bg-muted/70",
                                        )}
                                      >
                                        {mailboxInitials(outbound ? currentInboxEmail : readStringByKeys(message, ["from"]))}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="text-sm font-medium text-foreground">
                                          {outbound ? "You" : mailboxLabel(readStringByKeys(message, ["from"]))}
                                        </div>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                          {outbound ? currentInboxEmail : mailboxAddress(readStringByKeys(message, ["from"]))}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {formatDateValue(timestampFor(message))}
                                    </div>
                                  </div>
                                  <div className="px-4 py-4">
                                    <div className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                                      {readStringByKeys(message, ["text", "preview", "snippet"]) ?? "No text body available."}
                                    </div>
                                    {labels.length > 0 ? (
                                      <div className="mt-4 flex flex-wrap gap-2">
                                        {labels.map((label) => (
                                          <Badge key={`${messageId}-${label}`} variant="outline">{label}</Badge>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </div>

                      <div className="border-t border-border/70 pt-5">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Attachments</div>
                        {toAttachmentRecordList(selectedMessage).length === 0 ? (
                          <div className="mt-3 rounded-[24px] border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                            No attachments on this message.
                          </div>
                        ) : (
                          <div className="mt-3 space-y-3">
                            {toAttachmentRecordList(selectedMessage).map((attachment) => {
                              const attachmentId = entryIdFor(attachment) ?? recordName(attachment, "attachment");
                              return (
                                <div key={attachmentId} className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-border/70 bg-background/70 p-4">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-foreground">
                                      {readStringByKeys(attachment, ["filename"]) ?? attachmentId}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {readStringByKeys(attachment, ["content_type"]) ?? "attachment"}
                                    </div>
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="rounded-full border-border/70 bg-background/70 hover:border-primary/25 hover:bg-primary/[0.08]"
                                    onClick={() => void handleDownloadAttachment(selectedMessage, attachment)}
                                    disabled={pendingAction === "download-attachment"}
                                  >
                                    <Download className="h-4 w-4" />
                                    Download
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="outbox" className="mt-0 xl:col-span-2">
            <div className="overflow-hidden rounded-[28px] border border-border/70 bg-background/85 shadow-sm xl:h-[calc(100vh-12rem)]">
              <section className="flex min-h-0 h-full flex-col bg-muted/10">
                <div className="border-b border-border/70 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Outbox</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {currentInboxEmail ?? "Current inbox"} · {filteredDrafts.length} drafts · {filteredOutboundMessages.length} sent
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={startFreshComposer}>
                      <Plus className="h-4 w-4" />
                      New draft
                    </Button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/60">
                  <div className="p-4">
                    <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Drafts</div>
                    {draftsQuery.isLoading ? (
                      <PageSkeleton variant="list" />
                    ) : filteredDrafts.length === 0 ? (
                      <div className="rounded-[20px] border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                        {mailSearch.trim().length > 0 ? "No drafts match this search." : "No drafts saved yet."}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredDrafts.map((draft) => {
                          const draftId = draftIdFor(draft) ?? crypto.randomUUID();
                          const active = selectedDraftId === draftId;
                          return (
                            <div
                              key={draftId}
                              className={cn(
                                "rounded-[20px] border border-l-2 p-4 transition-[border-color,background-color,box-shadow,transform]",
                                active
                                  ? "border-primary/40 border-l-primary/80 bg-primary/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_24px_rgba(0,0,0,0.16)]"
                                  : "border-border/70 border-l-transparent bg-background/70 hover:border-border hover:bg-background/85 hover:shadow-sm",
                              )}
                            >
                              <div className="flex items-start gap-3">
                                <div
                                  className={cn(
                                    "flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold transition-[background-color,box-shadow]",
                                    active
                                      ? "bg-primary/[0.14] text-foreground shadow-[inset_0_0_0_1px_rgba(212,175,85,0.28)]"
                                      : "bg-muted/70 text-foreground",
                                  )}
                                >
                                  {mailboxInitials(readStringArray(draft.to)[0] ?? "Draft")}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className={cn("truncate text-sm transition-colors", active ? "font-semibold text-foreground" : "font-medium text-foreground")}>
                                        {readStringByKeys(draft, ["subject"]) ?? "(no subject)"}
                                      </div>
                                      <div className={cn("mt-1 truncate text-xs transition-colors", active ? "text-foreground/75" : "text-muted-foreground")}>
                                        {readStringArray(draft.to).join(", ") || "No recipients yet"}
                                      </div>
                                    </div>
                                    <div className={cn("text-xs transition-colors", active ? "text-foreground/75" : "text-muted-foreground")}>
                                      {formatMailListTimestamp(timestampFor(draft))}
                                    </div>
                                  </div>
                                  <div className={cn("mt-2 text-sm transition-colors", active ? "text-foreground/80" : "text-muted-foreground")}>
                                    {readStringByKeys(draft, ["preview"]) ?? "Draft not started"}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const nextComposer = applyDraftToComposer(draft, selectedInboxId);
                                    setSelectedDraftId(draftId);
                                    setComposer(nextComposer);
                                    setAdvancedRecipientsOpen(hasAdvancedRecipients(nextComposer));
                                    openComposerWindow("docked");
                                  }}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (!selectedCompanyId || !selectedInboxId) return;
                                    void runAction(
                                      `send-draft-${draftId}`,
                                      () => agentMailApi.sendDraft(selectedCompanyId, selectedInboxId, draftId),
                                      {
                                        successTitle: "Draft sent",
                                        invalidate: [invalidateInboxSurface],
                                      },
                                    );
                                  }}
                                >
                                  Send
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (!selectedCompanyId || !selectedInboxId) return;
                                    void runAction(
                                      `delete-draft-${draftId}`,
                                      () => agentMailApi.deleteDraft(selectedCompanyId, selectedInboxId, draftId),
                                      {
                                        successTitle: "Draft deleted",
                                        invalidate: [invalidateInboxSurface],
                                      },
                                    );
                                    if (selectedDraftId === draftId) {
                                      setComposer(emptyComposer(selectedInboxId));
                                      setSelectedDraftId(null);
                                      closeComposerWindow();
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="p-4">
                    <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Sent</div>
                    {messagesQuery.isLoading ? (
                      <PageSkeleton variant="list" />
                    ) : filteredOutboundMessages.length === 0 ? (
                      <div className="rounded-[20px] border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                        {mailSearch.trim().length > 0 ? "No sent messages match this search." : "No sent messages detected yet."}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredOutboundMessages.map((message) => {
                          const messageId = messageIdFor(message) ?? crypto.randomUUID();
                          return (
                            <div key={messageId} className="rounded-[20px] border border-border/70 bg-background/70 p-4">
                              <div className="flex items-start gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/70 text-xs font-semibold text-foreground">
                                  {mailboxInitials(readStringArray(message.to)[0] ?? "Sent")}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-medium text-foreground">
                                        {messageSubject(message)}
                                      </div>
                                      <div className="mt-1 truncate text-xs text-muted-foreground">
                                        {readStringArray(message.to).join(", ") || "No recipients"}
                                      </div>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {formatMailListTimestamp(timestampFor(message))}
                                    </div>
                                  </div>
                                  <div className="mt-2 text-sm text-muted-foreground">
                                    {messagePreview(message)}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button variant="outline" size="sm" onClick={() => openReplyComposer("forward", message)}>
                                  <Forward className="h-4 w-4" />
                                  Forward again
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </TabsContent>

            <TabsContent value="inboxes" className="mt-0 space-y-4 xl:col-span-2">
              <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                <Card className="rounded-[24px] border-border/70">
                  <CardHeader>
                    <CardTitle>Address management</CardTitle>
                    <CardDescription>
                      Company addresses are provisioned and managed automatically behind the scenes.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                      New inboxes are not created from the user workspace. If the company needs another address, an
                      agent or operator can provision it in the backend and it will appear here automatically.
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Primary address</div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {primaryInboxEmail ?? "Provisioning"}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Available addresses</div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {mailboxCount}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  <Card className="rounded-[24px] border-border/70">
                    <CardHeader>
                      <CardTitle>Selected address</CardTitle>
                      <CardDescription>
                        View the current mailbox identity and status.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {selectedInbox ? (
                        <>
                          <div className="grid gap-3">
                            <Field label="Email address">
                              <div className="rounded-2xl border border-border/70 bg-muted/10 px-3 py-3">
                                <MailboxIdentity
                                  email={readStringByKeys(selectedInbox, ["email", "address"])}
                                  name={readStringByKeys(selectedInbox, ["name"]) ?? (selectedInboxId === status?.primaryInboxId ? `${selectedCompany.name} Mail` : null)}
                                  fallbackName={`${selectedCompany.name} Mail`}
                                  preferAddressWhenUnnamed={selectedInboxId !== status?.primaryInboxId}
                                  nameClassName="text-sm"
                                  addressClassName="text-xs"
                                />
                              </div>
                            </Field>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-border/70 bg-muted/10 px-3 py-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Display name</div>
                              <div className="mt-2 text-sm font-medium text-foreground">
                                {readStringByKeys(selectedInbox, ["name"]) ??
                                  (selectedInboxId === status?.primaryInboxId ? `${selectedCompany.name} Mail` : "No display name")}
                              </div>
                            </div>
                            <div className="rounded-2xl border border-border/70 bg-muted/10 px-3 py-3">
                              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Status</div>
                              <div className="mt-2 text-sm font-medium text-foreground">
                                {readStringByKeys(selectedInbox, ["status"]) ?? "active"}
                              </div>
                            </div>
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-muted/10 px-3 py-3 text-sm text-muted-foreground">
                            This address is managed automatically. If it needs to be added, renamed, or retired, an
                            operator can handle that outside the user workspace.
                          </div>
                        </>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                          Select an address to inspect it.
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="rounded-[24px] border-border/70">
                    <CardHeader>
                      <CardTitle>All addresses</CardTitle>
                      <CardDescription>Primary and secondary mailboxes available for this company.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {filteredInboxes.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                          {mailSearch.trim().length > 0 ? "No addresses match this search." : "No addresses found."}
                        </div>
                      ) : (
                        filteredInboxes.map((inbox) => {
                          const inboxId = inboxIdFor(inbox) ?? crypto.randomUUID();
                          const isPrimary = inboxId === status?.primaryInboxId;
                          const inboxName =
                            readStringByKeys(inbox, ["name"]) ??
                            (isPrimary ? `${selectedCompany.name} Mail` : null);
                          return (
                            <button
                              key={inboxId}
                              type="button"
                              onClick={() => setSelectedInboxId(inboxId)}
                              className={cn(
                                "w-full rounded-2xl border p-4 text-left transition-colors",
                                inboxId === selectedInboxId
                                  ? "border-primary/40 bg-primary/5"
                                  : "border-border/70 bg-background/35 hover:bg-accent/30",
                              )}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <MailboxIdentity
                                  email={readStringByKeys(inbox, ["email", "address"]) ?? inboxId}
                                  name={inboxName}
                                  fallbackName="Mailbox"
                                  preferAddressWhenUnnamed={!isPrimary}
                                  className="min-w-0 flex-1"
                                  nameClassName="text-sm"
                                  addressClassName="text-xs"
                                />
                                <div className="flex gap-2">
                                  {isPrimary ? <Badge>Primary</Badge> : null}
                                  <Badge variant="outline">{readStringByKeys(inbox, ["status"]) ?? "active"}</Badge>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="domains" className="mt-0 space-y-4 xl:col-span-2">
              <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
                <Card className="rounded-[24px] border-border/70">
                  <CardHeader>
                    <CardTitle>Add domain</CardTitle>
                    <CardDescription>
                      Connect a verified sending domain for branded inbox addresses.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Field label="Domain">
                      <Input
                        value={createDomainForm.domain}
                        onChange={(event) => setCreateDomainForm({ domain: event.target.value })}
                        placeholder="mail.example.com"
                      />
                    </Field>
                    <Button
                      onClick={() => {
                        if (!selectedCompanyId) return;
                        void runAction(
                          "create-domain",
                          () => agentMailApi.createDomain(selectedCompanyId, createDomainForm),
                          {
                            successTitle: "Domain added",
                            invalidate: [async () => {
                              await queryClient.invalidateQueries({ queryKey: queryKeys.mail.domains(selectedCompanyId) });
                            }],
                          },
                        );
                        setCreateDomainForm({ domain: "" });
                      }}
                      disabled={pendingAction === "create-domain"}
                    >
                      <Globe className="h-4 w-4" />
                      Add domain
                    </Button>
                  </CardContent>
                </Card>

                <Card className="rounded-[24px] border-border/70">
                  <CardHeader>
                    <CardTitle>Domain inventory</CardTitle>
                    <CardDescription>
                      Verify DNS and remove stale domains when needed.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {domainsQuery.isLoading ? (
                      <PageSkeleton variant="list" />
                    ) : domains.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                        No custom domains connected yet.
                      </div>
                    ) : (
                      domains.map((domain) => {
                        const domainId = domainIdFor(domain) ?? crypto.randomUUID();
                        return (
                          <div key={domainId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/35 p-4">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">
                                {readStringByKeys(domain, ["domain"]) ?? domainId}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Status {readStringByKeys(domain, ["status"]) ?? "pending"}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (!selectedCompanyId) return;
                                  void runAction(
                                    `verify-domain-${domainId}`,
                                    () => agentMailApi.verifyDomain(selectedCompanyId, domainId),
                                    {
                                      successTitle: "Domain verification started",
                                      invalidate: [async () => {
                                        await queryClient.invalidateQueries({ queryKey: queryKeys.mail.domains(selectedCompanyId) });
                                        await invalidateStatusAndCompany();
                                      }],
                                    },
                                  );
                                }}
                              >
                                Verify
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (!selectedCompanyId) return;
                                  void runAction(
                                    `delete-domain-${domainId}`,
                                    () => agentMailApi.deleteDomain(selectedCompanyId, domainId),
                                    {
                                      successTitle: "Domain deleted",
                                      invalidate: [async () => {
                                        await queryClient.invalidateQueries({ queryKey: queryKeys.mail.domains(selectedCompanyId) });
                                      }],
                                    },
                                  );
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="labels" className="mt-0 space-y-4 xl:col-span-2">
              <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
                <Card className="rounded-[24px] border-border/70">
                  <CardHeader>
                    <CardTitle>Create filter</CardTitle>
                    <CardDescription>
                      Organize trusted senders, blocked senders, and simple routing rules for the selected address.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3">
                      <Field label="Filter name">
                        <Input
                          value={readString(createListForm.name)}
                          onChange={(event) => setCreateListForm((current) => ({ ...current, name: event.target.value }))}
                          placeholder="Investors"
                        />
                      </Field>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Applies to">
                          <Select
                            value={readString(createListForm.direction) || "inbound"}
                            onValueChange={(value) => setCreateListForm((current) => ({ ...current, direction: value }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="inbound">Inbound</SelectItem>
                              <SelectItem value="outbound">Outbound</SelectItem>
                              <SelectItem value="both">Both</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Filter type">
                          <Select
                            value={readString(createListForm.type) || "allowlist"}
                            onValueChange={(value) => setCreateListForm((current) => ({ ...current, type: value }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="allowlist">Allowed senders</SelectItem>
                              <SelectItem value="blocklist">Blocked senders</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                    </div>
                    <Button
                      onClick={() => {
                        if (!selectedCompanyId || !selectedInboxId) return;
                        void runAction(
                          "create-list",
                          () => agentMailApi.createList(selectedCompanyId, selectedInboxId, createListForm),
                          {
                            successTitle: "Filter created",
                            invalidate: [invalidateInboxSurface],
                          },
                        );
                        setCreateListForm({ name: "", direction: "inbound", type: "allowlist" });
                      }}
                      disabled={!selectedInboxId || pendingAction === "create-list"}
                    >
                      <Plus className="h-4 w-4" />
                      Create filter
                    </Button>
                  </CardContent>
                </Card>

                <Card className="rounded-[24px] border-border/70">
                  <CardHeader>
                    <CardTitle>Active filters</CardTitle>
                    <CardDescription>
                      Saved filters for {currentInboxEmail ?? "the selected address"}.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {listsQuery.isLoading ? (
                      <PageSkeleton variant="list" />
                    ) : filteredLists.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                        {mailSearch.trim().length > 0 ? "No filters match this search." : "No filters found for this address."}
                      </div>
                    ) : (
                      filteredLists.map((list) => {
                        const listId = listIdFor(list) ?? crypto.randomUUID();
                        const entries = readRecordArray(list.entries).length > 0
                          ? readRecordArray(list.entries)
                          : readStringArray(list.entries).map((value) => ({ value }));
                        return (
                          <div key={listId} className="rounded-2xl border border-border/70 bg-background/35 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">
                                  {recordName(list, "Untitled filter")}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {formatMailFilterType(readStringByKeys(list, ["type"]))} · {formatMailFilterDirection(readStringByKeys(list, ["direction"]))}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (!selectedCompanyId || !selectedInboxId) return;
                                  void runAction(
                                    `delete-list-${listId}`,
                                    () => agentMailApi.deleteList(selectedCompanyId, selectedInboxId, listId),
                                    {
                                      successTitle: "Filter deleted",
                                      invalidate: [invalidateInboxSurface],
                                    },
                                  );
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </Button>
                            </div>

                            <div className="mt-4 space-y-2">
                              {entries.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-border/70 p-3 text-sm text-muted-foreground">
                                  No senders added yet.
                                </div>
                              ) : (
                                entries.map((entry) => {
                                  const entryId = entryIdFor(entry) ?? crypto.randomUUID();
                                  return (
                                    <div key={entryId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/15 px-3 py-2">
                                      <div className="text-sm text-foreground">
                                        {readStringByKeys(entry, ["value", "email", "domain"]) ?? entryId}
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          if (!selectedCompanyId || !selectedInboxId) return;
                                          void runAction(
                                            `delete-entry-${entryId}`,
                                            () => agentMailApi.deleteListEntry(selectedCompanyId, selectedInboxId, listId, entryId),
                                            {
                                              successTitle: "Sender removed",
                                              invalidate: [invalidateInboxSurface],
                                            },
                                          );
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        Remove
                                      </Button>
                                    </div>
                                  );
                                })
                              )}
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              <Input
                                value={listEntryInputs[listId] ?? ""}
                                onChange={(event) => setListEntryInputs((current) => ({ ...current, [listId]: event.target.value }))}
                                placeholder="Add email or domain"
                                className="min-w-[14rem] flex-1"
                              />
                              <Button
                                variant="outline"
                                onClick={() => {
                                  const value = (listEntryInputs[listId] ?? "").trim();
                                  if (!selectedCompanyId || !selectedInboxId || value.length === 0) return;
                                  void runAction(
                                    `create-entry-${listId}`,
                                    () =>
                                      agentMailApi.createListEntry(
                                        selectedCompanyId,
                                        selectedInboxId,
                                        listId,
                                        { value } as CreateCompanyMailListEntry,
                                      ),
                                    {
                                      successTitle: "Sender added",
                                      invalidate: [invalidateInboxSurface],
                                    },
                                  );
                                  setListEntryInputs((current) => ({ ...current, [listId]: "" }));
                                }}
                              >
                                Add sender
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="access" className="mt-0 space-y-4 xl:col-span-2">
              <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="space-y-4">
                  <Card className="rounded-[24px] border-border/70">
                    <CardHeader>
                      <CardTitle>Issue API key</CardTitle>
                      <CardDescription>
                        Create pod-scoped or inbox-scoped AgentMail keys. Persisting a key stores it in company secrets; keys are not auto-injected into agents.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Scope">
                          <Select
                            value={apiKeyForm.scope ?? "pod"}
                            onValueChange={(value) =>
                              setApiKeyForm((current) => ({
                                ...current,
                                scope: value as "pod" | "inbox",
                                inboxId: value === "inbox" ? (current.inboxId ?? selectedInboxId ?? null) : null,
                              }))
                            }
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pod">Pod</SelectItem>
                              <SelectItem value="inbox">Inbox</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Name">
                          <Input
                            value={apiKeyForm.name}
                            onChange={(event) => setApiKeyForm((current) => ({ ...current, name: event.target.value }))}
                            placeholder="automation-webhook"
                          />
                        </Field>
                      </div>
                      {apiKeyForm.scope === "inbox" ? (
                        <Field label="Inbox">
                          <Select
                            value={apiKeyForm.inboxId ?? selectedInboxId ?? undefined}
                            onValueChange={(value) => setApiKeyForm((current) => ({ ...current, inboxId: value }))}
                          >
                            <SelectTrigger><SelectValue placeholder="Select inbox" /></SelectTrigger>
                            <SelectContent>
                              {inboxes.map((inbox) => {
                                const id = inboxIdFor(inbox);
                                if (!id) return null;
                                return (
                                  <SelectItem key={id} value={id}>
                                    {readStringByKeys(inbox, ["email", "address"]) ?? id}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </Field>
                      ) : null}
                      <Field label="Permissions">
                        <Input
                          value={apiKeyPermissionsInput}
                          onChange={(event) => setApiKeyPermissionsInput(event.target.value)}
                          placeholder="messages:read, messages:send"
                        />
                      </Field>
                      <Field label="Description">
                        <Input
                          value={readString(apiKeyForm.description)}
                          onChange={(event) => setApiKeyForm((current) => ({ ...current, description: event.target.value || null }))}
                          placeholder="Used by the outreach workflow"
                        />
                      </Field>
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Expires at (ISO, optional)">
                          <Input
                            value={readString(apiKeyForm.expiresAt)}
                            onChange={(event) => setApiKeyForm((current) => ({ ...current, expiresAt: event.target.value || null }))}
                            placeholder="2026-12-31T23:59:59Z"
                          />
                        </Field>
                        <Field label="Secret name (optional)">
                          <Input
                            value={readString(apiKeyForm.secretName)}
                            onChange={(event) => setApiKeyForm((current) => ({ ...current, secretName: event.target.value || null }))}
                            placeholder="AGENTMAIL_OUTREACH_KEY"
                          />
                        </Field>
                      </div>
                      <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/35 p-3">
                        <Checkbox
                          id="persist-agentmail-key"
                          checked={Boolean(apiKeyForm.persistSecret)}
                          onCheckedChange={(checked) =>
                            setApiKeyForm((current) => ({ ...current, persistSecret: Boolean(checked) }))
                          }
                        />
                        <div className="space-y-1">
                          <Label htmlFor="persist-agentmail-key" className="text-sm font-medium text-foreground">
                            Persist key in company secrets
                          </Label>
                          <div className="text-xs text-muted-foreground">
                            Store the issued key as a Paperclip secret so operators can reuse it safely later.
                          </div>
                        </div>
                      </div>
                      <Button
                        onClick={() => {
                          if (!selectedCompanyId) return;
                          void runAction(
                            "create-api-key",
                            () =>
                              agentMailApi.createApiKey(selectedCompanyId, {
                                ...apiKeyForm,
                                permissions: splitAgentMailList(apiKeyPermissionsInput),
                              }),
                            {
                              successTitle: "API key issued",
                              invalidate: [invalidateAccessSurface],
                            },
                          ).then((issued) => {
                            setIssuedApiKey({
                              apiKey: issued.apiKey,
                              apiKeyId: issued.apiKeyId,
                              secretName: issued.secretName,
                              secretId: issued.secretId,
                            });
                            setApiKeyForm({
                              scope: "pod",
                              inboxId: null,
                              name: "",
                              permissions: [],
                              description: null,
                              expiresAt: null,
                              persistSecret: false,
                              secretName: null,
                            });
                            setApiKeyPermissionsInput("");
                          });
                        }}
                        disabled={pendingAction === "create-api-key"}
                      >
                        <KeyRound className="h-4 w-4" />
                        Issue key
                      </Button>
                    </CardContent>
                  </Card>

                  {issuedApiKey ? (
                    <Card className="rounded-[24px] border-emerald-400/30 bg-emerald-500/5">
                      <CardHeader>
                        <CardTitle>Latest issued key</CardTitle>
                        <CardDescription>
                          AgentMail only returns the raw key once. Copy it now if you did not persist it.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="rounded-2xl border border-emerald-400/25 bg-background/60 p-4">
                          <div className="break-all font-mono text-sm text-foreground">
                            {issuedApiKey.apiKey ?? "The key value was not returned by AgentMail."}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>Key id {issuedApiKey.apiKeyId ?? "—"}</span>
                          <span>•</span>
                          <span>Secret {issuedApiKey.secretName ?? "not persisted"}</span>
                        </div>
                        {issuedApiKey.apiKey ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              void copyText(issuedApiKey.apiKey!).then((copied) => {
                                pushToast({
                                  title: copied ? "API key copied" : "Clipboard unavailable",
                                  body: copied ? "The AgentMail key has been copied to your clipboard." : "Copy the key manually from the panel.",
                                  tone: copied ? "success" : "warn",
                                });
                              });
                            }}
                          >
                            Copy key
                          </Button>
                        ) : null}
                      </CardContent>
                    </Card>
                  ) : null}
                </div>

                <div className="space-y-4">
                  <Card className="rounded-[24px] border-border/70">
                    <CardHeader>
                      <CardTitle>API key inventory</CardTitle>
                      <CardDescription>Existing pod and inbox scoped keys.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">Pod keys</div>
                        {(podApiKeysQuery.isLoading || inboxApiKeysQuery.isLoading) && activeTab === "access" ? (
                          <PageSkeleton variant="list" />
                        ) : podKeys.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                            No pod-scoped keys issued.
                          </div>
                        ) : (
                          podKeys.map((key) => {
                            const keyId = apiKeyIdFor(key) ?? crypto.randomUUID();
                            return (
                              <div key={keyId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/35 p-4">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">
                                    {recordName(key, keyId)}
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {readStringByKeys(key, ["description", "scope"]) ?? "pod"}
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (!selectedCompanyId) return;
                                    void runAction(
                                      `delete-api-key-${keyId}`,
                                      () => agentMailApi.deleteApiKey(selectedCompanyId, keyId, { scope: "pod" }),
                                      {
                                        successTitle: "API key deleted",
                                        invalidate: [invalidateAccessSurface],
                                      },
                                    );
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </Button>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">Inbox keys</div>
                        {!selectedInboxId ? (
                          <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                            Select an inbox to inspect inbox-scoped keys.
                          </div>
                        ) : inboxKeys.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                            No inbox-scoped keys issued for {currentInboxEmail ?? "this inbox"}.
                          </div>
                        ) : (
                          inboxKeys.map((key) => {
                            const keyId = apiKeyIdFor(key) ?? crypto.randomUUID();
                            return (
                              <div key={keyId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/35 p-4">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">
                                    {recordName(key, keyId)}
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {readStringByKeys(key, ["description", "scope"]) ?? "inbox"}
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (!selectedCompanyId || !selectedInboxId) return;
                                    void runAction(
                                      `delete-inbox-api-key-${keyId}`,
                                      () => agentMailApi.deleteApiKey(selectedCompanyId, keyId, { scope: "inbox", inboxId: selectedInboxId }),
                                      {
                                        successTitle: "Inbox API key deleted",
                                        invalidate: [invalidateAccessSurface],
                                      },
                                    );
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </Button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="rounded-[24px] border-border/70">
                    <CardHeader>
                      <CardTitle>Webhooks</CardTitle>
                      <CardDescription>
                        Paperclip uses Svix-verified webhooks for freshness and repairability. Create additional destinations when operators need them.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3">
                        <Field label="URL">
                          <Input
                            value={readString(webhookForm.url)}
                            onChange={(event) => setWebhookForm((current) => ({ ...current, url: event.target.value }))}
                            placeholder="https://example.com/hooks/agentmail"
                          />
                        </Field>
                        <Field label="Description">
                          <Input
                            value={readString(webhookForm.description)}
                            onChange={(event) => setWebhookForm((current) => ({ ...current, description: event.target.value }))}
                            placeholder="Ops relay"
                          />
                        </Field>
                        <Field label="Event types">
                          <Input
                            value={webhookEventInput}
                            onChange={(event) => setWebhookEventInput(event.target.value)}
                            placeholder="message.received, message.sent"
                          />
                        </Field>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (!selectedCompanyId) return;
                          void runAction(
                            "create-webhook",
                            () =>
                              agentMailApi.createWebhook(selectedCompanyId, {
                                ...webhookForm,
                                eventTypes: splitAgentMailList(webhookEventInput),
                              }),
                            {
                              successTitle: "Webhook created",
                              invalidate: [invalidateAccessSurface],
                            },
                          ).then(() => {
                            setWebhookForm({ url: "", description: "", eventTypes: [] });
                          });
                        }}
                        disabled={pendingAction === "create-webhook"}
                      >
                        <Plus className="h-4 w-4" />
                        Create webhook
                      </Button>

                      <div className="space-y-2">
                        {webhooksQuery.isLoading ? (
                          <PageSkeleton variant="list" />
                        ) : webhooks.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                            No webhook destinations registered.
                          </div>
                        ) : (
                          webhooks.map((webhook) => {
                            const webhookId = webhookIdFor(webhook) ?? crypto.randomUUID();
                            return (
                              <div key={webhookId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/35 p-4">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">
                                    {readStringByKeys(webhook, ["url"]) ?? webhookId}
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {readStringByKeys(webhook, ["description"]) ?? "Webhook"}
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (!selectedCompanyId) return;
                                    void runAction(
                                      `delete-webhook-${webhookId}`,
                                      () => agentMailApi.deleteWebhook(selectedCompanyId, webhookId),
                                      {
                                        successTitle: "Webhook deleted",
                                        invalidate: [invalidateAccessSurface],
                                      },
                                    );
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </Button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="protocols" className="mt-0 space-y-4 xl:col-span-2">
              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="rounded-[24px] border-border/70">
                  <CardHeader>
                    <CardTitle>SMTP</CardTitle>
                    <CardDescription>
                      Live today for transactional and operator-driven sending.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Host">
                          <Input value={status?.smtp.host ?? "smtp.agentmail.to"} readOnly />
                        </Field>
                        <Field label="Port">
                          <Input value={String(status?.smtp.port ?? 465)} readOnly />
                        </Field>
                        <Field label="Secure">
                          <Input value={(status?.smtp.secure ?? true) ? "true" : "false"} readOnly />
                        </Field>
                        <Field label="Username">
                          <Input value={currentInboxEmail ?? status?.smtp.username ?? ""} readOnly />
                        </Field>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Use the inbox address as the SMTP username. Mailboxes created here are immediately available for send flows and mailbox-scoped API keys.
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-[24px] border-border/70">
                  <CardHeader>
                    <CardTitle>IMAP</CardTitle>
                    <CardDescription>
                      Visible for planning, but still treated as preview until AgentMail marks it generally available.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="Host">
                          <Input value={status?.imap.host ?? "imap.agentmail.to"} readOnly />
                        </Field>
                        <Field label="Port">
                          <Input value={String(status?.imap.port ?? 993)} readOnly />
                        </Field>
                        <Field label="Secure">
                          <Input value={(status?.imap.secure ?? true) ? "true" : "false"} readOnly />
                        </Field>
                        <Field label="Availability">
                          <Input value={status?.imap.availability ?? "preview"} readOnly />
                        </Field>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-100">
                      Ship SMTP-first. Keep IMAP exposed as a read-only preview until the upstream product marks it live.
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-[24px] border-border/70">
                <CardHeader>
                  <CardTitle>Operational notes</CardTitle>
                  <CardDescription>
                    Useful defaults for operators and agents consuming the company mail system.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Inbox className="h-4 w-4" />
                      Inbox identity
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      Current mailbox: <span className="font-medium text-foreground">{currentInboxEmail ?? "—"}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <ShieldCheck className="h-4 w-4" />
                      Webhook verification
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      Events are verified with Svix signatures before Paperclip updates mail freshness state.
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Server className="h-4 w-4" />
                      Pod isolation
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      One company maps to one AgentMail pod using deterministic client ids for safe retries.
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {composerOpen ? (
            <div className="pointer-events-none fixed inset-0 z-50">
              <section
                aria-label={`${composerDialogTitle} composer`}
                className={cn(
                  "pointer-events-auto fixed flex flex-col overflow-hidden rounded-[24px] border border-border/80 bg-popover/95 shadow-[0_18px_36px_rgba(0,0,0,0.22),0_40px_96px_rgba(0,0,0,0.42)] ring-1 ring-black/5 backdrop-blur-xl transition-[width,height,top,right,bottom,left,transform,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] dark:ring-white/8",
                  composerWindowMode === "expanded"
                    ? "top-16 bottom-3 left-3 right-3 sm:top-auto sm:right-6 sm:bottom-6 sm:left-auto sm:h-[min(84vh,860px)] sm:w-[min(60rem,calc(100vw-3rem))]"
                    : composerWindowMode === "minimized"
                      ? "bottom-3 left-3 right-3 h-14 sm:right-6 sm:bottom-6 sm:left-auto sm:w-[min(24rem,calc(100vw-1.5rem))]"
                      : "bottom-3 left-3 right-3 h-[min(72svh,680px)] sm:right-6 sm:bottom-6 sm:left-auto sm:h-[min(72vh,720px)] sm:w-[min(42rem,calc(100vw-2rem))]",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-between gap-3 bg-card/95 px-4 py-3 backdrop-blur-xl",
                    composerWindowMode === "minimized" ? "border-b-0" : "border-b border-border/70",
                  )}
                  onDoubleClick={() =>
                    setComposerWindowMode((current) => (current === "expanded" ? "docked" : "expanded"))
                  }
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      if (composerWindowMode === "minimized") {
                        setComposerWindowMode("docked");
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{composerWindowTitle}</span>
                      {composer.mode === "draft" ? (
                        <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px] uppercase tracking-[0.18em]">
                          Draft
                        </Badge>
                      ) : null}
                    </div>
                    {composerWindowSubtitle ? (
                      <div className="mt-1 truncate text-xs text-muted-foreground/85">{composerWindowSubtitle}</div>
                    ) : null}
                  </button>
                  <div className="flex items-center gap-1">
                    {composerWindowMode === "minimized" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        onClick={() => setComposerWindowMode("docked")}
                      >
                        <Maximize2 className="h-4 w-4" />
                        <span className="sr-only">Restore composer</span>
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          onClick={() => setComposerWindowMode("minimized")}
                        >
                          <Minus className="h-4 w-4" />
                          <span className="sr-only">Minimize composer</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          onClick={() => setComposerWindowMode((current) => (current === "expanded" ? "docked" : "expanded"))}
                        >
                          {composerWindowMode === "expanded" ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                          <span className="sr-only">
                            {composerWindowMode === "expanded" ? "Restore composer size" : "Expand composer"}
                          </span>
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                      onClick={closeComposerWindow}
                    >
                      <X className="h-4 w-4" />
                      <span className="sr-only">Close composer</span>
                    </Button>
                  </div>
                </div>

                {composerWindowMode !== "minimized" ? (
                  <>
                    <ScrollArea className="min-h-0 flex-1">
                      <div className="px-5 py-4">
                        <div className="overflow-hidden">
                          <div className="border-b border-border/60 px-4">
                            <div className={cn(composerRowClasses(), "grid min-h-[56px] grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 border-b border-border/60")}>
                              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70 transition-colors duration-150 group-hover/compose-row:text-muted-foreground group-focus-within/compose-row:text-foreground/85">
                                From
                              </span>
                              <div className="min-w-0">
                                <Select
                                  value={composer.inboxId ?? selectedInboxId ?? undefined}
                                  onValueChange={(value) => setComposer((current) => ({ ...current, inboxId: value }))}
                                >
                                  <SelectTrigger className="h-auto min-h-0 w-full justify-start gap-2 rounded-lg border-0 bg-transparent px-0 py-0 shadow-none transition-[color,transform] duration-150 hover:text-foreground group-hover/compose-row:translate-x-0.5 focus:ring-0 focus-visible:ring-0">
                                    {composerInbox ? (
                                      <InlineMailboxIdentity
                                        email={readStringByKeys(composerInbox, ["email", "address"])}
                                        name={readStringByKeys(composerInbox, ["name"]) ?? (inboxIdFor(composerInbox) === status?.primaryInboxId ? `${selectedCompany.name} Mail` : null)}
                                        fallbackName={`${selectedCompany.name} Mail`}
                                        preferAddressWhenUnnamed={(composer.inboxId ?? selectedInboxId) !== status?.primaryInboxId}
                                      />
                                    ) : (
                                      <span className="text-sm text-muted-foreground">Choose inbox</span>
                                    )}
                                  </SelectTrigger>
                                  <SelectContent>
                                    {inboxes.map((inbox) => {
                                      const id = inboxIdFor(inbox);
                                      if (!id) return null;
                                      return (
                                        <SelectItem key={id} value={id}>
                                          <InlineMailboxIdentity
                                            email={readStringByKeys(inbox, ["email", "address"])}
                                            name={readStringByKeys(inbox, ["name"]) ?? (id === status?.primaryInboxId ? `${selectedCompany.name} Mail` : null)}
                                            fallbackName={`${selectedCompany.name} Mail`}
                                            preferAddressWhenUnnamed={id !== status?.primaryInboxId}
                                          />
                                        </SelectItem>
                                      );
                                    })}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            <div className={cn(composerRowClasses(), "grid min-h-[54px] grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 border-b border-border/60")}>
                              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70 transition-colors duration-150 group-hover/compose-row:text-muted-foreground group-focus-within/compose-row:text-foreground/85">
                                To
                              </span>
                              <Input
                                value={composer.to}
                                onChange={(event) => setComposer((current) => ({ ...current, to: event.target.value }))}
                                placeholder="alice@example.com, bob@example.com"
                                className="h-11 border-0 bg-transparent px-0 shadow-none transition-colors duration-150 group-hover/compose-row:text-foreground focus-visible:ring-0"
                              />
                            </div>

                            <Collapsible open={advancedRecipientsOpen} onOpenChange={setAdvancedRecipientsOpen} className="border-b border-border/60">
                              <CollapsibleTrigger asChild>
                                <button
                                  type="button"
                                  className={cn(
                                    composerRowClasses(advancedRecipientsOpen),
                                    "grid min-h-[54px] w-full grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 text-left hover:text-foreground",
                                  )}
                                >
                                  <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70 transition-colors duration-150 group-hover/compose-row:text-muted-foreground group-focus-within/compose-row:text-foreground/85">
                                    More
                                  </span>
                                  <div className="truncate text-sm text-foreground transition-transform duration-150 group-hover/compose-row:translate-x-0.5">
                                    {advancedRecipientCount > 0
                                      ? `${advancedRecipientCount} advanced field${advancedRecipientCount === 1 ? "" : "s"} configured`
                                      : "CC, BCC, reply-to"}
                                  </div>
                                  {advancedRecipientsOpen ? (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-150 group-hover/compose-row:translate-x-0.5" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform duration-150 group-hover/compose-row:translate-x-0.5" />
                                  )}
                                </button>
                              </CollapsibleTrigger>
                              <CollapsibleContent className="border-t border-border/50 pb-3 pt-2">
                                <div className={cn(composerRowClasses(), "grid min-h-[46px] grid-cols-[4rem_minmax(0,1fr)] items-center gap-3")}>
                                  <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70 transition-colors duration-150 group-hover/compose-row:text-muted-foreground group-focus-within/compose-row:text-foreground/85">
                                    CC
                                  </span>
                                  <Input
                                    value={composer.cc}
                                    onChange={(event) => setComposer((current) => ({ ...current, cc: event.target.value }))}
                                    placeholder="team@example.com"
                                    className="h-10 border-0 bg-transparent px-0 shadow-none transition-colors duration-150 group-hover/compose-row:text-foreground focus-visible:ring-0"
                                  />
                                </div>
                                <div className={cn(composerRowClasses(), "grid min-h-[46px] grid-cols-[4rem_minmax(0,1fr)] items-center gap-3")}>
                                  <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70 transition-colors duration-150 group-hover/compose-row:text-muted-foreground group-focus-within/compose-row:text-foreground/85">
                                    BCC
                                  </span>
                                  <Input
                                    value={composer.bcc}
                                    onChange={(event) => setComposer((current) => ({ ...current, bcc: event.target.value }))}
                                    placeholder="ops@example.com"
                                    className="h-10 border-0 bg-transparent px-0 shadow-none transition-colors duration-150 group-hover/compose-row:text-foreground focus-visible:ring-0"
                                  />
                                </div>
                                <div className={cn(composerRowClasses(), "grid min-h-[46px] grid-cols-[4rem_minmax(0,1fr)] items-center gap-3")}>
                                  <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70 transition-colors duration-150 group-hover/compose-row:text-muted-foreground group-focus-within/compose-row:text-foreground/85">
                                    Reply
                                  </span>
                                  <Input
                                    value={composer.replyTo}
                                    onChange={(event) => setComposer((current) => ({ ...current, replyTo: event.target.value }))}
                                    placeholder="founder@example.com"
                                    className="h-10 border-0 bg-transparent px-0 shadow-none transition-colors duration-150 group-hover/compose-row:text-foreground focus-visible:ring-0"
                                  />
                                </div>
                              </CollapsibleContent>
                            </Collapsible>

                            <div className={cn(composerRowClasses(), "grid min-h-[54px] grid-cols-[4rem_minmax(0,1fr)] items-center gap-3")}>
                              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70 transition-colors duration-150 group-hover/compose-row:text-muted-foreground group-focus-within/compose-row:text-foreground/85">
                                Subject
                              </span>
                              <Input
                                value={composer.subject}
                                onChange={(event) => setComposer((current) => ({ ...current, subject: event.target.value }))}
                                placeholder="Subject"
                                className="h-11 border-0 bg-transparent px-0 shadow-none transition-colors duration-150 group-hover/compose-row:text-foreground focus-visible:ring-0"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-3 px-4 py-4">
                            <div className="pt-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
                              Message
                            </div>

                            <div className="space-y-4">
                              <RichMailEditor
                                value={composer.html}
                                onChange={(nextHtml) =>
                                  setComposer((current) => ({
                                    ...current,
                                    html: nextHtml,
                                    text: htmlToPlainText(nextHtml),
                                  }))
                                }
                                placeholder="Write your message"
                              />

                              <div
                                className={cn(
                                  "space-y-3 rounded-[18px] border border-dashed border-border/70 bg-muted/10 p-3.5 transition-[border-color,background-color,box-shadow] duration-150 hover:border-border hover:bg-muted/[0.14]",
                                  attachmentDropActive && "border-primary/40 bg-muted/20",
                                )}
                                onDragOver={(event) => {
                                  event.preventDefault();
                                  if (!attachmentDropActive) setAttachmentDropActive(true);
                                }}
                                onDragLeave={(event) => {
                                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                    setAttachmentDropActive(false);
                                  }
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  setAttachmentDropActive(false);
                                  void appendComposerAttachments(Array.from(event.dataTransfer.files ?? []));
                                }}
                              >
                                <input
                                  ref={attachmentInputRef}
                                  type="file"
                                  multiple
                                  className="hidden"
                                  onChange={(event) => void handleComposerAttachmentChange(event)}
                                />
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                                      <span>Attachments</span>
                                      {composerAttachmentCount > 0 ? (
                                        <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                          {composerAttachmentCount} file{composerAttachmentCount === 1 ? "" : "s"}
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {composerAttachmentCount > 0
                                        ? `${(composerAttachmentBytes / 1024 / 1024).toFixed(composerAttachmentBytes >= 1024 * 1024 ? 1 : 2)} MB attached`
                                        : "Drop files here or add them from your device."}
                                    </div>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="rounded-full"
                                    onClick={() => attachmentInputRef.current?.click()}
                                  >
                                    <Paperclip className="h-4 w-4" />
                                    Attach files
                                  </Button>
                                </div>
                                {composer.attachments.length > 0 ? (
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    {composer.attachments.map((attachment, index) => (
                                      <div key={`${attachment.filename}-${index}`} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/80 px-3 py-3">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/30 text-muted-foreground">
                                          <Paperclip className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate text-sm font-medium text-foreground">{attachment.filename}</div>
                                          <div className="mt-1 text-xs text-muted-foreground">
                                            {(attachment.contentType ?? "attachment").replace("application/", "").replace("image/", "image/")}
                                            {" · "}
                                            {(() => {
                                              const content = attachment.content ?? "";
                                              const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
                                              const bytes = Math.max(0, Math.floor((content.length * 3) / 4) - padding);
                                              return bytes >= 1024 * 1024
                                                ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
                                                : `${Math.max(1, Math.round(bytes / 1024))} KB`;
                                            })()}
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                          aria-label={`Remove ${attachment.filename}`}
                                          onClick={() => removeComposerAttachment(index)}
                                        >
                                          <X className="h-4 w-4" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </ScrollArea>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-card/90 px-5 py-3 backdrop-blur-xl">
                      <div className="text-xs text-muted-foreground">
                        {composer.mode === "draft"
                          ? "Sending updates the draft first, then dispatches it."
                          : "Save the current composer state as a draft or send immediately."}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" className="rounded-full" onClick={closeComposerWindow}>
                          Close
                        </Button>
                        <Button variant="outline" className="rounded-full" onClick={() => void handleSaveDraft()} disabled={pendingAction === "save-draft"}>
                          Save draft
                        </Button>
                        <Button className="rounded-full" onClick={() => void handleSendComposer()} disabled={pendingAction === "send-composer"}>
                          <Send className="h-4 w-4" />
                          {composer.mode === "draft" ? "Send draft" : "Send message"}
                        </Button>
                      </div>
                    </div>
                  </>
                ) : null}
              </section>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
