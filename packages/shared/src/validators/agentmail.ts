import { z } from "zod";
import { COMPANY_MAIL_PROVISIONING_STATUSES } from "../constants.js";

const recipientListSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);

export const companyMailProvisioningStatusSchema = z.enum(COMPANY_MAIL_PROVISIONING_STATUSES);

export const agentMailAttachmentInputSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
  contentType: z.string().nullable().optional(),
  contentDisposition: z.enum(["attachment", "inline"]).optional(),
  contentId: z.string().nullable().optional(),
});

export const createCompanyMailInboxSchema = z.object({
  name: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  domain: z.string().min(1).nullable().optional(),
}).passthrough();

export const updateCompanyMailInboxSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
}).passthrough();

export const companyMailMessageSendSchema = z.object({
  inboxId: z.string().min(1),
  to: recipientListSchema,
  cc: recipientListSchema.optional(),
  bcc: recipientListSchema.optional(),
  replyTo: recipientListSchema.optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  labels: z.array(z.string().min(1)).optional(),
  attachments: z.array(agentMailAttachmentInputSchema).optional(),
}).passthrough();

export const companyMailMessageReplySchema = z.object({
  to: recipientListSchema.optional(),
  cc: recipientListSchema.optional(),
  bcc: recipientListSchema.optional(),
  replyTo: recipientListSchema.optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  labels: z.array(z.string().min(1)).optional(),
  attachments: z.array(agentMailAttachmentInputSchema).optional(),
}).passthrough();

export const companyMailMessageForwardSchema = companyMailMessageReplySchema.extend({
  to: recipientListSchema,
});

export const companyMailMessageUpdateSchema = z.object({
  addLabels: z.array(z.string().min(1)).optional(),
  removeLabels: z.array(z.string().min(1)).optional(),
  labels: z.array(z.string().min(1)).optional(),
}).passthrough();

export const createCompanyMailDraftSchema = z.object({
  inboxId: z.string().min(1),
  to: recipientListSchema.optional(),
  cc: recipientListSchema.optional(),
  bcc: recipientListSchema.optional(),
  replyTo: recipientListSchema.optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  labels: z.array(z.string().min(1)).optional(),
  attachments: z.array(agentMailAttachmentInputSchema).optional(),
}).passthrough();

export const updateCompanyMailDraftSchema = z.object({
  to: recipientListSchema.optional(),
  cc: recipientListSchema.optional(),
  bcc: recipientListSchema.optional(),
  replyTo: recipientListSchema.optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  labels: z.array(z.string().min(1)).optional(),
  attachments: z.array(agentMailAttachmentInputSchema).optional(),
}).passthrough();

export const createCompanyMailDomainSchema = z.object({
  domain: z.string().min(1),
}).passthrough();

export const createCompanyMailListSchema = z.object({
  inboxId: z.string().min(1),
  name: z.string().min(1).optional(),
  direction: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
}).passthrough();

export const createCompanyMailListEntrySchema = z.object({
  value: z.string().min(1),
}).passthrough();

export const createCompanyMailApiKeySchema = z.object({
  scope: z.enum(["pod", "inbox"]).default("pod"),
  inboxId: z.string().min(1).nullable().optional(),
  name: z.string().min(1),
  permissions: z.array(z.string().min(1)).optional(),
  description: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  persistSecret: z.boolean().optional(),
  secretName: z.string().min(1).nullable().optional(),
}).passthrough();

export const createCompanyMailWebhookSchema = z.object({
  url: z.string().url().optional(),
  description: z.string().nullable().optional(),
  eventTypes: z.array(z.string().min(1)).optional(),
}).passthrough();

export type AgentMailAttachmentInput = z.infer<typeof agentMailAttachmentInputSchema>;
export type CreateCompanyMailInbox = z.infer<typeof createCompanyMailInboxSchema>;
export type UpdateCompanyMailInbox = z.infer<typeof updateCompanyMailInboxSchema>;
export type CompanyMailMessageSend = z.infer<typeof companyMailMessageSendSchema>;
export type CompanyMailMessageReply = z.infer<typeof companyMailMessageReplySchema>;
export type CompanyMailMessageForward = z.infer<typeof companyMailMessageForwardSchema>;
export type CompanyMailMessageUpdate = z.infer<typeof companyMailMessageUpdateSchema>;
export type CreateCompanyMailDraft = z.infer<typeof createCompanyMailDraftSchema>;
export type UpdateCompanyMailDraft = z.infer<typeof updateCompanyMailDraftSchema>;
export type CreateCompanyMailDomain = z.infer<typeof createCompanyMailDomainSchema>;
export type CreateCompanyMailList = z.infer<typeof createCompanyMailListSchema>;
export type CreateCompanyMailListEntry = z.infer<typeof createCompanyMailListEntrySchema>;
export type CreateCompanyMailApiKey = z.infer<typeof createCompanyMailApiKeySchema>;
export type CreateCompanyMailWebhook = z.infer<typeof createCompanyMailWebhookSchema>;
