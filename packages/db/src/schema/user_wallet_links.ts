import { pgTable, uuid, text, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";

export const userWalletLinks = pgTable(
  "user_wallet_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    chainType: text("chain_type"),
    walletType: text("wallet_type").notNull(),
    walletClientType: text("wallet_client_type"),
    connectorType: text("connector_type"),
    isPrimary: boolean("is_primary").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userWalletUniqueIdx: uniqueIndex("user_wallet_links_user_wallet_unique_idx").on(
      table.userId,
      table.address,
      table.chainType,
      table.walletType,
    ),
    userIdx: index("user_wallet_links_user_idx").on(table.userId),
    addressIdx: index("user_wallet_links_address_idx").on(table.address),
  }),
);
