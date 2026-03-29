CREATE TABLE "user_wallet_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"chain_type" text,
	"wallet_type" text NOT NULL,
	"wallet_client_type" text,
	"connector_type" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_wallet_links" ADD CONSTRAINT "user_wallet_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_wallet_links_user_wallet_unique_idx" ON "user_wallet_links" USING btree ("user_id","address","chain_type","wallet_type");--> statement-breakpoint
CREATE INDEX "user_wallet_links_user_idx" ON "user_wallet_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_wallet_links_address_idx" ON "user_wallet_links" USING btree ("address");