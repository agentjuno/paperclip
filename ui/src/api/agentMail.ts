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
  CompanyMailMessageForward,
  CompanyMailMessageReply,
  CompanyMailMessageSend,
  CompanyMailMessageUpdate,
  CompanyMailStatus,
  CreateCompanyMailApiKey,
  CreateCompanyMailDomain,
  CreateCompanyMailDraft,
  CreateCompanyMailInbox,
  CreateCompanyMailList,
  CreateCompanyMailListEntry,
  CreateCompanyMailWebhook,
  ProvisionCompanyMailResponse,
  UpdateCompanyMailDraft,
  UpdateCompanyMailInbox,
} from "@paperclipai/shared";
import { api } from "./client";

type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

function withQuery(path: string, query?: Record<string, QueryValue>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, String(entry));
      }
      continue;
    }
    params.append(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export const agentMailApi = {
  status: (companyId: string) =>
    api.get<CompanyMailStatus>(`/companies/${companyId}/mail/status`),
  provision: (companyId: string) =>
    api.post<ProvisionCompanyMailResponse>(`/companies/${companyId}/mail/provision`, {}),
  listInboxes: (companyId: string, query?: Record<string, QueryValue>) =>
    api.get<AgentMailCollectionResponse<AgentMailInbox>>(
      withQuery(`/companies/${companyId}/mail/inboxes`, query),
    ),
  createInbox: (companyId: string, body: CreateCompanyMailInbox) =>
    api.post<AgentMailInbox>(`/companies/${companyId}/mail/inboxes`, body),
  updateInbox: (companyId: string, inboxId: string, body: UpdateCompanyMailInbox) =>
    api.patch<AgentMailInbox>(`/companies/${companyId}/mail/inboxes/${inboxId}`, body),
  deleteInbox: (companyId: string, inboxId: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/mail/inboxes/${inboxId}`),
  listThreads: (companyId: string, query?: Record<string, QueryValue>) =>
    api.get<AgentMailCollectionResponse<AgentMailThread>>(
      withQuery(`/companies/${companyId}/mail/threads`, query),
    ),
  listMessages: (companyId: string, inboxId: string, query?: Record<string, QueryValue>) =>
    api.get<AgentMailCollectionResponse<AgentMailMessage>>(
      withQuery(`/companies/${companyId}/mail/inboxes/${inboxId}/messages`, query),
    ),
  getMessage: (companyId: string, inboxId: string, messageId: string) =>
    api.get<AgentMailMessage>(`/companies/${companyId}/mail/inboxes/${inboxId}/messages/${messageId}`),
  updateMessage: (companyId: string, inboxId: string, messageId: string, body: CompanyMailMessageUpdate) =>
    api.patch<AgentMailMessage>(
      `/companies/${companyId}/mail/inboxes/${inboxId}/messages/${messageId}`,
      body,
    ),
  sendMessage: (companyId: string, body: CompanyMailMessageSend) =>
    api.post<AgentMailMessage>(`/companies/${companyId}/mail/messages/send`, body),
  replyToMessage: (
    companyId: string,
    inboxId: string,
    messageId: string,
    body: CompanyMailMessageReply,
  ) =>
    api.post<AgentMailMessage>(
      `/companies/${companyId}/mail/inboxes/${inboxId}/messages/${messageId}/reply`,
      body,
    ),
  forwardMessage: (
    companyId: string,
    inboxId: string,
    messageId: string,
    body: CompanyMailMessageForward,
  ) =>
    api.post<AgentMailMessage>(
      `/companies/${companyId}/mail/inboxes/${inboxId}/messages/${messageId}/forward`,
      body,
    ),
  getAttachment: (companyId: string, inboxId: string, messageId: string, attachmentId: string) =>
    api.get<AgentMailRecord>(
      `/companies/${companyId}/mail/inboxes/${inboxId}/messages/${messageId}/attachments/${attachmentId}`,
    ),
  listDrafts: (companyId: string, query?: Record<string, QueryValue>) =>
    api.get<AgentMailCollectionResponse<AgentMailDraft>>(
      withQuery(`/companies/${companyId}/mail/drafts`, query),
    ),
  createDraft: (companyId: string, body: CreateCompanyMailDraft) =>
    api.post<AgentMailDraft>(`/companies/${companyId}/mail/drafts`, body),
  updateDraft: (companyId: string, inboxId: string, draftId: string, body: UpdateCompanyMailDraft) =>
    api.patch<AgentMailDraft>(
      `/companies/${companyId}/mail/inboxes/${inboxId}/drafts/${draftId}`,
      body,
    ),
  sendDraft: (companyId: string, inboxId: string, draftId: string) =>
    api.post<AgentMailMessage>(
      `/companies/${companyId}/mail/inboxes/${inboxId}/drafts/${draftId}/send`,
      {},
    ),
  deleteDraft: (companyId: string, inboxId: string, draftId: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/mail/inboxes/${inboxId}/drafts/${draftId}`),
  listDomains: (companyId: string, query?: Record<string, QueryValue>) =>
    api.get<AgentMailCollectionResponse<AgentMailDomain>>(
      withQuery(`/companies/${companyId}/mail/domains`, query),
    ),
  createDomain: (companyId: string, body: CreateCompanyMailDomain) =>
    api.post<AgentMailDomain>(`/companies/${companyId}/mail/domains`, body),
  verifyDomain: (companyId: string, domainId: string) =>
    api.post<AgentMailDomain>(`/companies/${companyId}/mail/domains/${domainId}/verify`, {}),
  deleteDomain: (companyId: string, domainId: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/mail/domains/${domainId}`),
  listLists: (companyId: string, inboxId: string, query?: Record<string, QueryValue>) =>
    api.get<AgentMailCollectionResponse<AgentMailList>>(
      withQuery(`/companies/${companyId}/mail/inboxes/${inboxId}/lists`, query),
    ),
  createList: (companyId: string, inboxId: string, body: Omit<CreateCompanyMailList, "inboxId">) =>
    api.post<AgentMailList>(`/companies/${companyId}/mail/inboxes/${inboxId}/lists`, body),
  createListEntry: (
    companyId: string,
    inboxId: string,
    listId: string,
    body: CreateCompanyMailListEntry,
  ) =>
    api.post<AgentMailRecord>(
      `/companies/${companyId}/mail/inboxes/${inboxId}/lists/${listId}/entries`,
      body,
    ),
  deleteList: (companyId: string, inboxId: string, listId: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/mail/inboxes/${inboxId}/lists/${listId}`),
  deleteListEntry: (companyId: string, inboxId: string, listId: string, entryId: string) =>
    api.delete<{ ok: true }>(
      `/companies/${companyId}/mail/inboxes/${inboxId}/lists/${listId}/entries/${entryId}`,
    ),
  listApiKeys: (
    companyId: string,
    options?: { scope?: "pod" | "inbox"; inboxId?: string | null },
  ) =>
    api.get<AgentMailCollectionResponse<AgentMailApiKey>>(
      withQuery(`/companies/${companyId}/mail/api-keys`, {
        scope: options?.scope ?? "pod",
        inboxId: options?.inboxId ?? undefined,
      }),
    ),
  createApiKey: (companyId: string, body: CreateCompanyMailApiKey) =>
    api.post<CompanyMailApiKeyIssueResponse>(`/companies/${companyId}/mail/api-keys`, body),
  deleteApiKey: (
    companyId: string,
    apiKeyId: string,
    options?: { scope?: "pod" | "inbox"; inboxId?: string | null },
  ) =>
    api.delete<{ ok: true }>(
      withQuery(`/companies/${companyId}/mail/api-keys/${apiKeyId}`, {
        scope: options?.scope ?? "pod",
        inboxId: options?.inboxId ?? undefined,
      }),
    ),
  listWebhooks: (companyId: string) =>
    api.get<AgentMailCollectionResponse<AgentMailWebhook>>(`/companies/${companyId}/mail/webhooks`),
  createWebhook: (companyId: string, body: CreateCompanyMailWebhook) =>
    api.post<{ webhook: AgentMailWebhook; status: CompanyMailStatus }>(
      `/companies/${companyId}/mail/webhooks`,
      body,
    ),
  deleteWebhook: (companyId: string, webhookId: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/mail/webhooks/${webhookId}`),
};
