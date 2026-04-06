CREATE TABLE "company_agentmail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provisioning_status" text DEFAULT 'not_started' NOT NULL,
	"pod_id" text,
	"pod_client_id" text,
	"primary_inbox_id" text,
	"primary_inbox_email" text,
	"webhook_id" text,
	"webhook_client_id" text,
	"webhook_secret" text,
	"last_webhook_event_type" text,
	"last_webhook_event_at" timestamp with time zone,
	"last_delivery_event_type" text,
	"last_domain_event_type" text,
	"last_error" text,
	"provisioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_agentmail" ADD CONSTRAINT "company_agentmail_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_agentmail_company_uq" ON "company_agentmail" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_agentmail_pod_idx" ON "company_agentmail" USING btree ("pod_id");--> statement-breakpoint
CREATE INDEX "company_agentmail_primary_inbox_idx" ON "company_agentmail" USING btree ("primary_inbox_id");--> statement-breakpoint
CREATE INDEX "company_agentmail_webhook_idx" ON "company_agentmail" USING btree ("webhook_id");