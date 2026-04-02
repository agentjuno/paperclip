import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { approvals } from "./approvals.js";
import { companies } from "./companies.js";
import { companyTokenLaunches } from "./company_token_launches.js";

export const companyTokenLaunchRequests = pgTable(
  "company_token_launch_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    launchId: uuid("launch_id").notNull().references(() => companyTokenLaunches.id),
    approvalId: uuid("approval_id").notNull().references(() => approvals.id),
    submittedByUserId: text("submitted_by_user_id").notNull(),
    feeWalletAddress: text("fee_wallet_address").notNull(),
    simulationFingerprint: text("simulation_fingerprint").notNull(),
    bankrPayload: jsonb("bankr_payload").$type<Record<string, unknown>>().notNull(),
    simulationResult: jsonb("simulation_result").$type<Record<string, unknown>>().notNull(),
    deployStatus: text("deploy_status").notNull().default("not_started"),
    deploymentError: text("deployment_error"),
    deploymentErrorDetails: jsonb("deployment_error_details").$type<Record<string, unknown>>(),
    confirmedByUserId: text("confirmed_by_user_id"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    tokenAddress: text("token_address"),
    poolId: text("pool_id"),
    txHash: text("tx_hash"),
    activityId: text("activity_id"),
    chain: text("chain"),
    feeDistribution: jsonb("fee_distribution").$type<Record<string, unknown>>(),
    deployedAt: timestamp("deployed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    approvalUniqueIdx: uniqueIndex("company_token_launch_requests_approval_uq").on(table.approvalId),
    companyCreatedIdx: index("company_token_launch_requests_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    launchCreatedIdx: index("company_token_launch_requests_launch_created_idx").on(
      table.launchId,
      table.createdAt,
    ),
    companyDeployedUniqueIdx: uniqueIndex("company_token_launch_requests_company_deployed_uq")
      .on(table.companyId)
      .where(sql`${table.tokenAddress} is not null`),
  }),
);
