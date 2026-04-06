import type { AgentMailMessage } from "@paperclipai/shared";

export function splitAgentMailList(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildAgentMailSubject(prefix: string, subject: string | null | undefined) {
  const base = subject?.trim() ?? "";
  if (!base) return `${prefix}: `;
  if (base.toLowerCase().startsWith(`${prefix.toLowerCase()}:`)) return base;
  return `${prefix}: ${base}`;
}

function readStringArray(value: unknown): string[] {
  if (typeof value === "string") return splitAgentMailList(value);
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeMailLabel(label: string) {
  return label.trim().toLowerCase();
}

export function isUnreadMailMessage(message: AgentMailMessage) {
  const labels = readStringArray(message.labels).map(normalizeMailLabel);
  if (labels.includes("read")) return false;
  return labels.includes("unread");
}

export function applyMailLabelMutation(
  message: AgentMailMessage,
  input: {
    addLabels?: string[] | null;
    removeLabels?: string[] | null;
    labels?: string[] | null;
  },
) {
  if (Array.isArray(input.labels)) {
    return {
      ...message,
      labels: readStringArray(input.labels),
    } satisfies AgentMailMessage;
  }

  const nextLabels = readStringArray(message.labels);
  const indexByLabel = new Map(nextLabels.map((label, index) => [normalizeMailLabel(label), index] as const));

  for (const label of readStringArray(input.removeLabels)) {
    const key = normalizeMailLabel(label);
    const existingIndex = indexByLabel.get(key);
    if (existingIndex === undefined) continue;
    nextLabels.splice(existingIndex, 1);
    indexByLabel.clear();
    nextLabels.forEach((entry, index) => indexByLabel.set(normalizeMailLabel(entry), index));
  }

  for (const label of readStringArray(input.addLabels)) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    const key = normalizeMailLabel(trimmed);
    if (indexByLabel.has(key)) continue;
    indexByLabel.set(key, nextLabels.length);
    nextLabels.push(trimmed);
  }

  return {
    ...message,
    labels: nextLabels,
  } satisfies AgentMailMessage;
}

export function isOutboundMailMessage(message: AgentMailMessage, inboxEmail: string | null) {
  const labels = readStringArray(message.labels).map((entry) => entry.toLowerCase());
  if (labels.includes("sent") || labels.includes("outbound")) return true;
  const direction = readNullableString(message.direction)?.toLowerCase();
  if (direction === "outbound" || direction === "sent") return true;
  const from = readNullableString(message.from)?.toLowerCase() ?? "";
  return Boolean(inboxEmail && from.includes(inboxEmail.toLowerCase()));
}
