import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyAgentmail = pgTable(
  "company_agentmail",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provisioningStatus: text("provisioning_status").notNull().default("not_started"),
    podId: text("pod_id"),
    podClientId: text("pod_client_id"),
    primaryInboxId: text("primary_inbox_id"),
    primaryInboxEmail: text("primary_inbox_email"),
    webhookId: text("webhook_id"),
    webhookClientId: text("webhook_client_id"),
    webhookSecret: text("webhook_secret"),
    lastWebhookEventType: text("last_webhook_event_type"),
    lastWebhookEventAt: timestamp("last_webhook_event_at", { withTimezone: true }),
    lastDeliveryEventType: text("last_delivery_event_type"),
    lastDomainEventType: text("last_domain_event_type"),
    lastError: text("last_error"),
    provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUniqueIdx: uniqueIndex("company_agentmail_company_uq").on(table.companyId),
    podIdx: index("company_agentmail_pod_idx").on(table.podId),
    inboxIdx: index("company_agentmail_primary_inbox_idx").on(table.primaryInboxId),
    webhookIdx: index("company_agentmail_webhook_idx").on(table.webhookId),
  }),
);
