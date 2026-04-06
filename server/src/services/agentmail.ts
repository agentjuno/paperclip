import { Webhook } from "svix";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, companyAgentmail } from "@paperclipai/db";
import type {
  AgentMailApiKey,
  AgentMailCollectionResponse,
  AgentMailDomain,
  AgentMailDraft,
  AgentMailInbox,
  AgentMailList,
  AgentMailMessage,
  AgentMailRecord,
  AgentMailThread,
  AgentMailWebhook,
  CompanyMailApiKeyIssueResponse,
  CompanyMailStatus,
  CreateCompanyMailApiKey,
  CreateCompanyMailDomain,
  CreateCompanyMailDraft,
  CreateCompanyMailInbox,
  CreateCompanyMailList,
  CreateCompanyMailListEntry,
  CreateCompanyMailWebhook,
  ProvisionCompanyMailResponse,
  SecretProvider,
  UpdateCompanyMailDraft,
  UpdateCompanyMailInbox,
} from "@paperclipai/shared";
import { badRequest, forbidden, notFound, HttpError } from "../errors.js";
import { secretService } from "./secrets.js";

type CompanyMailRow = typeof companyAgentmail.$inferSelect;
type ActorInfo = { userId?: string | null; agentId?: string | null };

const DEFAULT_AGENTMAIL_BASE_URL = "https://api.agentmail.to/v0";
const DEFAULT_WEBHOOK_EVENT_TYPES = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.bounced",
  "message.complained",
  "message.rejected",
  "domain.verified",
];

function getAgentMailBaseUrl() {
  return (process.env.AGENTMAIL_API_BASE_URL?.trim() || DEFAULT_AGENTMAIL_BASE_URL).replace(/\/+$/, "");
}

function getAgentMailApiKey() {
  const apiKey = process.env.AGENTMAIL_API_KEY?.trim();
  if (!apiKey) {
    throw new HttpError(503, "AGENTMAIL_API_KEY is not configured");
  }
  return apiKey;
}

function getConfiguredSecretProvider() {
  const configuredDefaultProvider = process.env.PAPERCLIP_SECRETS_PROVIDER;
  if (configuredDefaultProvider && configuredDefaultProvider.length > 0) {
    return configuredDefaultProvider as SecretProvider;
  }
  return "local_encrypted" as const;
}

function readHeaderValue(value: string | string[] | undefined) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

function normalizeWebhookHeaders(headers: Record<string, string | string[] | undefined>) {
  return {
    "svix-id": readHeaderValue(headers["svix-id"] ?? headers["webhook-id"]),
    "svix-timestamp": readHeaderValue(headers["svix-timestamp"] ?? headers["webhook-timestamp"]),
    "svix-signature": readHeaderValue(headers["svix-signature"] ?? headers["webhook-signature"]),
  };
}

function resolveWebhookBaseUrl() {
  const candidates = [
    process.env.PAPERCLIP_PUBLIC_URL,
    process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL,
    process.env.BETTER_AUTH_URL,
    process.env.BETTER_AUTH_BASE_URL,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString().replace(/\/+$/, "");
      }
    } catch {
      // Ignore malformed public URL candidates.
    }
  }
  return null;
}

function buildWebhookUrl(companyId: string) {
  const baseUrl = resolveWebhookBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl}/api/agentmail/webhooks/${companyId}`;
}

function asRecord(value: unknown): AgentMailRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as AgentMailRecord;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStringByKeys(record: AgentMailRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return null;
}

function readArray(value: unknown): AgentMailRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asRecord(entry));
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function normalizeCollection(
  payload: unknown,
  keys: string[],
): AgentMailCollectionResponse {
  if (Array.isArray(payload)) {
    return {
      items: payload.map((entry) => asRecord(entry)),
      count: payload.length,
      nextCursor: null,
      raw: { items: payload as unknown[] },
    };
  }

  const record = asRecord(payload);
  for (const key of keys) {
    if (Array.isArray(record[key])) {
      const items = readArray(record[key]);
      const countCandidate = record.count ?? record.total_count ?? record.total ?? items.length;
      return {
        items,
        count: typeof countCandidate === "number" ? countCandidate : items.length,
        nextCursor: readString(record.next_cursor) ?? readString(record.cursor) ?? readString(record.next),
        raw: record,
      };
    }
  }

  return {
    items: [],
    count: 0,
    nextCursor: null,
    raw: record,
  };
}

function appendQueryValue(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const entry of value) appendQueryValue(params, key, entry);
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    params.append(key, String(value));
  }
}

function toQueryString(query?: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    appendQueryValue(params, key, value);
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

const AGENTMAIL_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~-]+$/;

function sanitizeAgentMailClientIdSegment(value: string) {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._~-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "id";
}

export function normalizeAgentMailClientId(clientId: string | null | undefined, fallback: string) {
  const value = clientId?.trim();
  if (!value) return fallback;
  if (AGENTMAIL_CLIENT_ID_PATTERN.test(value)) return value;

  const normalized = value
    .split(/[^A-Za-z0-9._~-]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(".");

  return normalized && AGENTMAIL_CLIENT_ID_PATTERN.test(normalized) ? normalized : fallback;
}

function buildAgentMailClientId(...segments: string[]) {
  return segments
    .map((segment) => sanitizeAgentMailClientIdSegment(segment))
    .join(".");
}

export function normalizeAgentMailMessageUpdateBody(body: Record<string, unknown>) {
  const {
    addLabels,
    removeLabels,
    add_labels,
    remove_labels,
    ...rest
  } = body;

  const normalized: Record<string, unknown> = { ...rest };
  const nextAddLabels = add_labels ?? addLabels;
  const nextRemoveLabels = remove_labels ?? removeLabels;

  if (nextAddLabels !== undefined) {
    normalized.add_labels = nextAddLabels;
  }

  if (nextRemoveLabels !== undefined) {
    normalized.remove_labels = nextRemoveLabels;
  }

  return normalized;
}

function diffAgentMailLabels(currentLabels: string[], nextLabels: string[]) {
  const currentKeys = new Set(currentLabels.map((label) => label.toLowerCase()));
  const nextKeys = new Set(nextLabels.map((label) => label.toLowerCase()));

  return {
    add_labels: nextLabels.filter((label) => !currentKeys.has(label.toLowerCase())),
    remove_labels: currentLabels.filter((label) => !nextKeys.has(label.toLowerCase())),
  };
}

export function buildPodClientId(companyId: string) {
  return buildAgentMailClientId("company", companyId);
}

export function buildPrimaryInboxClientId(companyId: string) {
  return buildAgentMailClientId("company", companyId, "primary");
}

export function buildWebhookClientId(companyId: string) {
  return buildAgentMailClientId("company", companyId, "webhook");
}

function defaultMailStatus(companyId: string): CompanyMailStatus {
  return {
    companyId,
    provisioningStatus: "not_started",
    podId: null,
    podClientId: buildPodClientId(companyId),
    primaryInboxId: null,
    primaryInboxEmail: null,
    webhookId: null,
    webhookConfigured: false,
    lastWebhookEventType: null,
    lastWebhookEventAt: null,
    lastDeliveryEventType: null,
    lastDomainEventType: null,
    lastError: null,
    provisionedAt: null,
    smtp: {
      host: "smtp.agentmail.to",
      port: 465,
      secure: true,
      username: null,
    },
    imap: {
      host: "imap.agentmail.to",
      port: 993,
      secure: true,
      username: null,
      availability: "preview",
    },
  };
}

function toMailStatus(companyId: string, row: CompanyMailRow | null): CompanyMailStatus {
  const fallback = defaultMailStatus(companyId);
  if (!row) return fallback;
  return {
    ...fallback,
    provisioningStatus: (row.provisioningStatus as CompanyMailStatus["provisioningStatus"]) ?? fallback.provisioningStatus,
    podId: row.podId ?? null,
    podClientId: row.podClientId ?? fallback.podClientId,
    primaryInboxId: row.primaryInboxId ?? null,
    primaryInboxEmail: row.primaryInboxEmail ?? null,
    webhookId: row.webhookId ?? null,
    webhookConfigured: Boolean(row.webhookId && row.webhookSecret),
    lastWebhookEventType: row.lastWebhookEventType ?? null,
    lastWebhookEventAt: row.lastWebhookEventAt ?? null,
    lastDeliveryEventType: row.lastDeliveryEventType ?? null,
    lastDomainEventType: row.lastDomainEventType ?? null,
    lastError: row.lastError ?? null,
    provisionedAt: row.provisionedAt ?? null,
    smtp: {
      ...fallback.smtp,
      username: row.primaryInboxEmail ?? null,
    },
    imap: {
      ...fallback.imap,
      username: row.primaryInboxEmail ?? null,
    },
  };
}

async function parseJsonResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204) return null;
  if (contentType.includes("application/json")) {
    return await response.json().catch(() => null);
  }
  const text = await response.text().catch(() => "");
  return text.length > 0 ? { message: text } : null;
}

function normalizeRemoteError(status: number, payload: unknown) {
  const record = asRecord(payload);
  const message =
    readString(record.error)
    ?? readString(record.message)
    ?? `AgentMail request failed (${status})`;
  return new HttpError(status, message, payload);
}

async function agentMailRequest<T>(
  path: string,
  init?: {
    method?: string;
    body?: unknown;
  },
): Promise<T> {
  const response = await fetch(`${getAgentMailBaseUrl()}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${getAgentMailApiKey()}`,
      "Content-Type": "application/json",
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw normalizeRemoteError(response.status, payload);
  }
  return payload as T;
}

async function getCompanyRow(db: Db, companyId: string) {
  return db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .then((rows) => rows[0] ?? null);
}

async function getMailRow(db: Db, companyId: string) {
  return db
    .select()
    .from(companyAgentmail)
    .where(eq(companyAgentmail.companyId, companyId))
    .then((rows) => rows[0] ?? null);
}

async function upsertMailRow(
  db: Db,
  companyId: string,
  patch: Partial<typeof companyAgentmail.$inferInsert>,
) {
  const now = new Date();
  const [row] = await db
    .insert(companyAgentmail)
    .values({
      companyId,
      podClientId: buildPodClientId(companyId),
      updatedAt: now,
      ...patch,
    })
    .onConflictDoUpdate({
      target: companyAgentmail.companyId,
      set: {
        ...patch,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

async function resolveReadyMailRow(db: Db, companyId: string) {
  const row = await getMailRow(db, companyId);
  if (!row || !row.podId) {
    throw new HttpError(409, "Mail is not provisioned for this company");
  }
  return row;
}

export async function ensureCompanyMailProvisioned(
  db: Db,
  input: { companyId: string; companyName: string },
) {
  const current = await getMailRow(db, input.companyId);
  const podClientId = normalizeAgentMailClientId(current?.podClientId, buildPodClientId(input.companyId));
  const inboxClientId = buildPrimaryInboxClientId(input.companyId);
  const webhookClientId = buildWebhookClientId(input.companyId);

  await upsertMailRow(db, input.companyId, {
    provisioningStatus: "setting_up",
    podClientId,
    lastError: null,
  });

  try {
    let podId = current?.podId ?? null;
    if (!podId) {
      const pod = asRecord(await agentMailRequest("/pods", {
        method: "POST",
        body: {
          client_id: podClientId,
          name: `${input.companyName} Mail`,
        },
      }));
      podId = readStringByKeys(pod, ["pod_id", "id"]);
      if (!podId) throw new Error("AgentMail pod response did not include pod_id");
    }

    let primaryInboxId = current?.primaryInboxId ?? null;
    let primaryInboxEmail = current?.primaryInboxEmail ?? null;
    if (!primaryInboxId) {
      const inbox = asRecord(await agentMailRequest(`/pods/${podId}/inboxes`, {
        method: "POST",
        body: {
          client_id: inboxClientId,
          name: `${input.companyName} Primary`,
        },
      }));
      primaryInboxId = readStringByKeys(inbox, ["inbox_id", "id"]);
      primaryInboxEmail = readStringByKeys(inbox, ["email", "address"]);
      if (!primaryInboxId) throw new Error("AgentMail inbox response did not include inbox_id");
    }

    let webhookId = current?.webhookId ?? null;
    let webhookSecret = current?.webhookSecret ?? null;
    const webhookUrl = buildWebhookUrl(input.companyId);
    let bestEffortError: string | null = null;

    if (!webhookId && webhookUrl) {
      try {
        const webhook = asRecord(await agentMailRequest("/webhooks", {
          method: "POST",
          body: {
            client_id: webhookClientId,
            url: webhookUrl,
            description: `${input.companyName} company mail events`,
            pod_ids: [podId],
            event_types: DEFAULT_WEBHOOK_EVENT_TYPES,
          },
        }));
        webhookId = readStringByKeys(webhook, ["webhook_id", "id"]);
        webhookSecret = readStringByKeys(webhook, ["secret", "signing_secret"]);
      } catch (error) {
        bestEffortError = error instanceof Error ? error.message : "Failed to configure AgentMail webhook";
      }
    }

    const row = await upsertMailRow(db, input.companyId, {
      provisioningStatus: "ready",
      podId,
      podClientId,
      primaryInboxId,
      primaryInboxEmail,
      webhookId,
      webhookClientId: webhookId ? webhookClientId : current?.webhookClientId ?? null,
      webhookSecret,
      lastError: bestEffortError,
      provisionedAt: new Date(),
    });

    return toMailStatus(input.companyId, row);
  } catch (error) {
    const row = await upsertMailRow(db, input.companyId, {
      provisioningStatus: "failed",
      podClientId,
      lastError: error instanceof Error ? error.message : "AgentMail provisioning failed",
    });
    return toMailStatus(input.companyId, row);
  }
}

export function agentMailService(db: Db) {
  async function status(companyId: string): Promise<CompanyMailStatus> {
    const row = await getMailRow(db, companyId);
    return toMailStatus(companyId, row);
  }

  async function provision(companyId: string): Promise<ProvisionCompanyMailResponse> {
    const company = await getCompanyRow(db, companyId);
    if (!company) throw notFound("Company not found");
    const nextStatus = await ensureCompanyMailProvisioned(db, {
      companyId,
      companyName: company.name,
    });
    return { status: nextStatus };
  }

  async function proxyPodCollection<T extends AgentMailRecord>(
    companyId: string,
    path: string,
    collectionKeys: string[],
    query?: Record<string, unknown>,
  ): Promise<AgentMailCollectionResponse<T>> {
    const row = await resolveReadyMailRow(db, companyId);
    const payload = await agentMailRequest(`${path}${toQueryString(query)}`);
    return normalizeCollection(payload, collectionKeys) as AgentMailCollectionResponse<T>;
  }

  async function proxyPodRecord<T extends AgentMailRecord>(
    companyId: string,
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(path, init)) as T;
  }

  async function listInboxes(companyId: string, query?: Record<string, unknown>) {
    const row = await resolveReadyMailRow(db, companyId);
    const payload = await agentMailRequest(`/pods/${row.podId}/inboxes${toQueryString(query)}`);
    return normalizeCollection(payload, ["inboxes", "items"]) as AgentMailCollectionResponse<AgentMailInbox>;
  }

  async function createInbox(companyId: string, input: CreateCompanyMailInbox) {
    const row = await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/pods/${row.podId}/inboxes`, {
      method: "POST",
      body: {
        client_id: input.clientId,
        name: input.name,
        username: input.username,
        domain: input.domain,
      },
    })) as AgentMailInbox;
  }

  async function updateInbox(companyId: string, inboxId: string, input: UpdateCompanyMailInbox) {
    const row = await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/pods/${row.podId}/inboxes/${inboxId}`, {
      method: "PATCH",
      body: input,
    })) as AgentMailInbox;
  }

  async function deleteInbox(companyId: string, inboxId: string) {
    const row = await resolveReadyMailRow(db, companyId);
    await agentMailRequest(`/pods/${row.podId}/inboxes/${inboxId}`, { method: "DELETE" });
    return { ok: true };
  }

  async function listThreads(companyId: string, query?: Record<string, unknown>) {
    const row = await resolveReadyMailRow(db, companyId);
    const inboxId = readString(query?.inboxId);
    const nextQuery = { ...query };
    delete nextQuery.inboxId;
    if (inboxId) {
      const payload = await agentMailRequest(`/inboxes/${inboxId}/threads${toQueryString(nextQuery)}`);
      return normalizeCollection(payload, ["threads", "items"]) as AgentMailCollectionResponse<AgentMailThread>;
    }
    const payload = await agentMailRequest(`/pods/${row.podId}/threads${toQueryString(nextQuery)}`);
    return normalizeCollection(payload, ["threads", "items"]) as AgentMailCollectionResponse<AgentMailThread>;
  }

  async function listMessages(companyId: string, inboxId: string, query?: Record<string, unknown>) {
    await resolveReadyMailRow(db, companyId);
    const payload = await agentMailRequest(`/inboxes/${inboxId}/messages${toQueryString(query)}`);
    return normalizeCollection(payload, ["messages", "items"]) as AgentMailCollectionResponse<AgentMailMessage>;
  }

  async function getMessage(companyId: string, inboxId: string, messageId: string) {
    await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/inboxes/${inboxId}/messages/${messageId}`)) as AgentMailMessage;
  }

  async function updateMessage(
    companyId: string,
    inboxId: string,
    messageId: string,
    body: Record<string, unknown>,
  ) {
    await resolveReadyMailRow(db, companyId);
    let normalizedBody = normalizeAgentMailMessageUpdateBody(body);

    if (normalizedBody.add_labels === undefined && normalizedBody.remove_labels === undefined && body.labels !== undefined) {
      const currentMessage = asRecord(await agentMailRequest(`/inboxes/${inboxId}/messages/${messageId}`)) as AgentMailMessage;
      const labelDiff = diffAgentMailLabels(readStringArray(currentMessage.labels), readStringArray(body.labels));
      normalizedBody = {
        ...normalizedBody,
        ...labelDiff,
      };
    }

    delete normalizedBody.labels;

    return asRecord(await agentMailRequest(`/inboxes/${inboxId}/messages/${messageId}`, {
      method: "PATCH",
      body: normalizedBody,
    })) as AgentMailMessage;
  }

  async function sendMessage(companyId: string, body: Record<string, unknown>) {
    const inboxId = readString(body.inboxId);
    if (!inboxId) throw badRequest("inboxId is required");
    await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/inboxes/${inboxId}/messages/send`, {
      method: "POST",
      body,
    })) as AgentMailMessage;
  }

  async function replyToMessage(
    companyId: string,
    inboxId: string,
    messageId: string,
    body: Record<string, unknown>,
  ) {
    await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/inboxes/${inboxId}/messages/${messageId}/reply`, {
      method: "POST",
      body,
    })) as AgentMailMessage;
  }

  async function forwardMessage(
    companyId: string,
    inboxId: string,
    messageId: string,
    body: Record<string, unknown>,
  ) {
    await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/inboxes/${inboxId}/messages/${messageId}/forward`, {
      method: "POST",
      body,
    })) as AgentMailMessage;
  }

  async function getAttachment(companyId: string, inboxId: string, messageId: string, attachmentId: string) {
    await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(
      `/inboxes/${inboxId}/messages/${messageId}/attachments/${attachmentId}`,
    ));
  }

  async function listDrafts(companyId: string, query?: Record<string, unknown>) {
    const row = await resolveReadyMailRow(db, companyId);
    const inboxId = readString(query?.inboxId);
    const nextQuery = { ...query };
    delete nextQuery.inboxId;
    if (inboxId) {
      const payload = await agentMailRequest(`/inboxes/${inboxId}/drafts${toQueryString(nextQuery)}`);
      return normalizeCollection(payload, ["drafts", "items"]) as AgentMailCollectionResponse<AgentMailDraft>;
    }
    const payload = await agentMailRequest(`/pods/${row.podId}/drafts${toQueryString(nextQuery)}`);
    return normalizeCollection(payload, ["drafts", "items"]) as AgentMailCollectionResponse<AgentMailDraft>;
  }

  async function createDraft(companyId: string, input: CreateCompanyMailDraft) {
    await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/inboxes/${input.inboxId}/drafts`, {
      method: "POST",
      body: input,
    })) as AgentMailDraft;
  }

  async function updateDraft(companyId: string, inboxId: string, draftId: string, input: UpdateCompanyMailDraft) {
    await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/inboxes/${inboxId}/drafts/${draftId}`, {
      method: "PATCH",
      body: input,
    })) as AgentMailDraft;
  }

  async function sendDraft(companyId: string, inboxId: string, draftId: string) {
    await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/inboxes/${inboxId}/drafts/${draftId}/send`, {
      method: "POST",
      body: {},
    })) as AgentMailMessage;
  }

  async function deleteDraft(companyId: string, inboxId: string, draftId: string) {
    await resolveReadyMailRow(db, companyId);
    await agentMailRequest(`/inboxes/${inboxId}/drafts/${draftId}`, { method: "DELETE" });
    return { ok: true };
  }

  async function listDomains(companyId: string, query?: Record<string, unknown>) {
    const row = await resolveReadyMailRow(db, companyId);
    const payload = await agentMailRequest(`/pods/${row.podId}/domains${toQueryString(query)}`);
    return normalizeCollection(payload, ["domains", "items"]) as AgentMailCollectionResponse<AgentMailDomain>;
  }

  async function createDomain(companyId: string, input: CreateCompanyMailDomain) {
    const row = await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/pods/${row.podId}/domains`, {
      method: "POST",
      body: input,
    })) as AgentMailDomain;
  }

  async function verifyDomain(companyId: string, domainId: string) {
    const row = await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/pods/${row.podId}/domains/${domainId}/verify`, {
      method: "POST",
      body: {},
    })) as AgentMailDomain;
  }

  async function deleteDomain(companyId: string, domainId: string) {
    const row = await resolveReadyMailRow(db, companyId);
    await agentMailRequest(`/pods/${row.podId}/domains/${domainId}`, { method: "DELETE" });
    return { ok: true };
  }

  async function listLists(companyId: string, inboxId: string, query?: Record<string, unknown>) {
    await resolveReadyMailRow(db, companyId);
    const payload = await agentMailRequest(`/inboxes/${inboxId}/lists${toQueryString(query)}`);
    return normalizeCollection(payload, ["lists", "items"]) as AgentMailCollectionResponse<AgentMailList>;
  }

  async function createList(companyId: string, input: CreateCompanyMailList) {
    await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/inboxes/${input.inboxId}/lists`, {
      method: "POST",
      body: input,
    })) as AgentMailList;
  }

  async function createListEntry(companyId: string, inboxId: string, listId: string, input: CreateCompanyMailListEntry) {
    await resolveReadyMailRow(db, companyId);
    return asRecord(await agentMailRequest(`/inboxes/${inboxId}/lists/${listId}/entries`, {
      method: "POST",
      body: input,
    }));
  }

  async function deleteList(companyId: string, inboxId: string, listId: string) {
    await resolveReadyMailRow(db, companyId);
    await agentMailRequest(`/inboxes/${inboxId}/lists/${listId}`, { method: "DELETE" });
    return { ok: true };
  }

  async function deleteListEntry(companyId: string, inboxId: string, listId: string, entryId: string) {
    await resolveReadyMailRow(db, companyId);
    await agentMailRequest(`/inboxes/${inboxId}/lists/${listId}/entries/${entryId}`, {
      method: "DELETE",
    });
    return { ok: true };
  }

  async function listApiKeys(
    companyId: string,
    options?: { scope?: "pod" | "inbox"; inboxId?: string | null },
  ) {
    const row = await resolveReadyMailRow(db, companyId);
    if (options?.scope === "inbox") {
      if (!options.inboxId) throw badRequest("inboxId is required when scope is inbox");
      const payload = await agentMailRequest(`/inboxes/${options.inboxId}/api-keys`);
      return normalizeCollection(payload, ["api_keys", "items"]) as AgentMailCollectionResponse<AgentMailApiKey>;
    }
    const payload = await agentMailRequest(`/pods/${row.podId}/api-keys`);
    return normalizeCollection(payload, ["api_keys", "items"]) as AgentMailCollectionResponse<AgentMailApiKey>;
  }

  async function createApiKey(
    companyId: string,
    input: CreateCompanyMailApiKey,
    actor?: ActorInfo,
  ): Promise<CompanyMailApiKeyIssueResponse> {
    const row = await resolveReadyMailRow(db, companyId);
    const scope = input.scope ?? "pod";
    if (scope === "inbox" && !input.inboxId) {
      throw badRequest("inboxId is required when scope is inbox");
    }

    const path = scope === "inbox"
      ? `/inboxes/${input.inboxId}/api-keys`
      : `/pods/${row.podId}/api-keys`;

    const record = asRecord(await agentMailRequest(path, {
      method: "POST",
      body: {
        name: input.name,
        permissions: input.permissions,
        description: input.description,
        expires_at: input.expiresAt,
      },
    })) as AgentMailApiKey;
    const apiKeyValue = readStringByKeys(record, ["api_key", "key", "token", "secret"]);
    const apiKeyId = readStringByKeys(record, ["api_key_id", "id"]);

    let secretId: string | null = null;
    let secretName: string | null = null;
    if (input.persistSecret) {
      if (!apiKeyValue) {
        throw new HttpError(502, "AgentMail did not return an API key value to persist");
      }
      const name = input.secretName?.trim() || `AGENTMAIL_${scope.toUpperCase()}_${input.name.trim().replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
      const createdSecret = await secretService(db).create(
        companyId,
        {
          name,
          provider: getConfiguredSecretProvider(),
          value: apiKeyValue,
          description: input.description ?? `AgentMail ${scope}-scoped key`,
        },
        actor,
      );
      secretId = createdSecret.id;
      secretName = createdSecret.name;
    }

    return {
      apiKeyId,
      apiKey: apiKeyValue,
      secretId,
      secretName,
      record,
    };
  }

  async function deleteApiKey(
    companyId: string,
    apiKeyId: string,
    options?: { scope?: "pod" | "inbox"; inboxId?: string | null },
  ) {
    const row = await resolveReadyMailRow(db, companyId);
    if (options?.scope === "inbox") {
      if (!options.inboxId) throw badRequest("inboxId is required when scope is inbox");
      await agentMailRequest(`/inboxes/${options.inboxId}/api-keys/${apiKeyId}`, { method: "DELETE" });
      return { ok: true };
    }
    await agentMailRequest(`/pods/${row.podId}/api-keys/${apiKeyId}`, { method: "DELETE" });
    return { ok: true };
  }

  async function listWebhooks(companyId: string) {
    const row = await resolveReadyMailRow(db, companyId);
    const payload = await agentMailRequest("/webhooks");
    const collection = normalizeCollection(payload, ["webhooks", "items"]) as AgentMailCollectionResponse<AgentMailWebhook>;
    const items = collection.items.filter((webhook) => {
      const webhookId = readStringByKeys(webhook, ["webhook_id", "id"]);
      const clientId = readStringByKeys(webhook, ["client_id"]);
      const podId = readStringByKeys(webhook, ["pod_id"]);
      const podIds = readStringArray(webhook.pod_ids);
      if (row.webhookId && webhookId === row.webhookId) return true;
      if (row.webhookClientId && clientId === row.webhookClientId) return true;
      if (row.podId && (podId === row.podId || podIds.includes(row.podId))) return true;
      return false;
    });
    return {
      ...collection,
      items,
      count: items.length,
    };
  }

  async function createWebhook(companyId: string, input?: CreateCompanyMailWebhook) {
    const row = await resolveReadyMailRow(db, companyId);
    const url = input?.url ?? buildWebhookUrl(companyId);
    if (!url) {
      throw new HttpError(422, "Webhook URL is not configured. Set PAPERCLIP_PUBLIC_URL to enable automatic webhook creation.");
    }
    const record = asRecord(await agentMailRequest("/webhooks", {
      method: "POST",
      body: {
        client_id: buildWebhookClientId(companyId),
        url,
        description: input?.description ?? "Paperclip company mail events",
        pod_ids: [row.podId],
        event_types: input?.eventTypes ?? DEFAULT_WEBHOOK_EVENT_TYPES,
      },
    })) as AgentMailWebhook;
    const nextRow = await upsertMailRow(db, companyId, {
      webhookId: readStringByKeys(record, ["webhook_id", "id"]),
      webhookClientId: buildWebhookClientId(companyId),
      webhookSecret: readStringByKeys(record, ["secret", "signing_secret"]),
      lastError: null,
    });
    return {
      webhook: record,
      status: toMailStatus(companyId, nextRow),
    };
  }

  async function deleteWebhook(companyId: string, webhookId: string) {
    await resolveReadyMailRow(db, companyId);
    await agentMailRequest(`/webhooks/${webhookId}`, { method: "DELETE" });
    const row = await getMailRow(db, companyId);
    if (row?.webhookId === webhookId) {
      await upsertMailRow(db, companyId, {
        webhookId: null,
        webhookClientId: null,
        webhookSecret: null,
      });
    }
    return { ok: true };
  }

  async function handleWebhook(companyId: string, rawBody: Buffer | string, headers: Record<string, string | string[] | undefined>) {
    const row = await getMailRow(db, companyId);
    if (!row?.webhookSecret) {
      throw notFound("AgentMail webhook not configured for company");
    }

    const verifier = new Webhook(row.webhookSecret);
    let message: AgentMailRecord;
    try {
      message = asRecord(verifier.verify(rawBody, normalizeWebhookHeaders(headers)));
    } catch {
      throw forbidden("Invalid AgentMail webhook signature");
    }

    const eventType = readString(message.event_type) ?? "unknown";
    const lastWebhookEventAt = new Date();
    const patch: Partial<typeof companyAgentmail.$inferInsert> = {
      lastWebhookEventType: eventType,
      lastWebhookEventAt,
      lastError: null,
    };
    if (eventType.startsWith("message.")) {
      patch.lastDeliveryEventType = eventType;
    }
    if (eventType.startsWith("domain.")) {
      patch.lastDomainEventType = eventType;
    }
    await upsertMailRow(db, companyId, patch);
    return message;
  }

  return {
    status,
    provision,
    listInboxes,
    createInbox,
    updateInbox,
    deleteInbox,
    listThreads,
    listMessages,
    getMessage,
    updateMessage,
    sendMessage,
    replyToMessage,
    forwardMessage,
    getAttachment,
    listDrafts,
    createDraft,
    updateDraft,
    sendDraft,
    deleteDraft,
    listDomains,
    createDomain,
    verifyDomain,
    deleteDomain,
    listLists,
    createList,
    createListEntry,
    deleteList,
    deleteListEntry,
    listApiKeys,
    createApiKey,
    deleteApiKey,
    listWebhooks,
    createWebhook,
    deleteWebhook,
    handleWebhook,
    proxyPodCollection,
    proxyPodRecord,
  };
}
