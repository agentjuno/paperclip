CREATE TABLE "stripe_customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"privy_user_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"subscription_id" text,
	"subscription_status" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_customers_privy_user_id_uq" ON "stripe_customers" USING btree ("privy_user_id");