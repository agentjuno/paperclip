import {
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const stripeCustomers = pgTable(
  "stripe_customers",
  {
    id: serial("id").primaryKey(),
    privyUserId: text("privy_user_id").notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    subscriptionId: text("subscription_id"),
    subscriptionStatus: text("subscription_status").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    privyUserIdUq: uniqueIndex("stripe_customers_privy_user_id_uq").on(table.privyUserId),
  }),
);
