import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const stripeProjectConnections = pgTable(
  "stripe_project_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    stripeProjectName: text("stripe_project_name").notNull(),
    stripeProjectDir: text("stripe_project_dir"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("stripe_project_connections_company_idx").on(table.companyId),
    companyProjectUq: uniqueIndex("stripe_project_connections_company_project_uq").on(
      table.companyId,
      table.projectId,
    ),
  }),
);

export const stripeProvisionedServices = pgTable(
  "stripe_provisioned_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => stripeProjectConnections.id, { onDelete: "cascade" }),
    providerService: text("provider_service").notNull(),
    provider: text("provider").notNull(),
    serviceType: text("service_type").notNull(),
    tier: text("tier"),
    status: text("status").notNull().default("active"),
    resourceMetadata: jsonb("resource_metadata").$type<Record<string, unknown>>(),
    provisionedAt: timestamp("provisioned_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    connectionIdx: index("stripe_provisioned_services_connection_idx").on(table.connectionId),
    connectionProviderServiceIdx: index("stripe_provisioned_services_connection_provider_service_idx").on(
      table.connectionId,
      table.providerService,
    ),
  }),
);
