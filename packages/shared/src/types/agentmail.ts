import type { CompanyMailProvisioningStatus } from "../constants.js";

export interface CompanyMailStatus {
  companyId: string;
  provisioningStatus: CompanyMailProvisioningStatus;
  podId: string | null;
  podClientId: string | null;
  primaryInboxId: string | null;
  primaryInboxEmail: string | null;
  webhookId: string | null;
  webhookConfigured: boolean;
  lastWebhookEventType: string | null;
  lastWebhookEventAt: Date | null;
  lastDeliveryEventType: string | null;
  lastDomainEventType: string | null;
  lastError: string | null;
  provisionedAt: Date | null;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    username: string | null;
  };
  imap: {
    host: string;
    port: number;
    secure: boolean;
    username: string | null;
    availability: "preview";
  };
}

export interface ProvisionCompanyMailResponse {
  status: CompanyMailStatus;
}

export type AgentMailRecord = Record<string, unknown>;

export interface AgentMailCollectionResponse<T extends AgentMailRecord = AgentMailRecord> {
  items: T[];
  count: number | null;
  nextCursor: string | null;
  raw: AgentMailRecord;
}

export interface AgentMailInbox extends AgentMailRecord {
  inbox_id?: string;
  id?: string;
  email?: string | null;
  name?: string | null;
}

export interface AgentMailMessage extends AgentMailRecord {
  message_id?: string;
  thread_id?: string | null;
  inbox_id?: string | null;
  subject?: string | null;
  preview?: string | null;
  text?: string | null;
  html?: string | null;
  from?: string | null;
  to?: string[] | null;
  labels?: string[] | null;
  timestamp?: string | null;
}

export interface AgentMailThread extends AgentMailRecord {
  thread_id?: string;
  inbox_id?: string | null;
  subject?: string | null;
  preview?: string | null;
  senders?: string[] | null;
  recipients?: string[] | null;
  labels?: string[] | null;
  timestamp?: string | null;
}

export interface AgentMailDraft extends AgentMailRecord {
  draft_id?: string;
  inbox_id?: string | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  to?: string[] | null;
  labels?: string[] | null;
  updated_at?: string | null;
}

export interface AgentMailDomain extends AgentMailRecord {
  domain_id?: string;
  domain?: string | null;
  status?: string | null;
}

export interface AgentMailList extends AgentMailRecord {
  list_id?: string;
  inbox_id?: string | null;
  direction?: string | null;
  type?: string | null;
  entries?: unknown[] | null;
}

export interface AgentMailApiKey extends AgentMailRecord {
  api_key_id?: string;
  id?: string;
  name?: string | null;
  scope?: string | null;
}

export interface AgentMailWebhook extends AgentMailRecord {
  webhook_id?: string;
  id?: string;
  url?: string | null;
  secret?: string | null;
}

export interface AgentMailAttachmentInput {
  filename: string;
  content: string;
  contentType?: string | null;
  contentDisposition?: "attachment" | "inline";
  contentId?: string | null;
}

export interface CompanyMailApiKeyIssueResponse {
  apiKeyId: string | null;
  apiKey: string | null;
  secretId: string | null;
  secretName: string | null;
  record: AgentMailApiKey | null;
}
