CREATE TABLE "company_token_launch_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"launch_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"submitted_by_user_id" text NOT NULL,
	"fee_wallet_address" text NOT NULL,
	"simulation_fingerprint" text NOT NULL,
	"bankr_payload" jsonb NOT NULL,
	"simulation_result" jsonb NOT NULL,
	"deploy_status" text DEFAULT 'not_started' NOT NULL,
	"deployment_error" text,
	"deployment_error_details" jsonb,
	"confirmed_by_user_id" text,
	"confirmed_at" timestamp with time zone,
	"token_address" text,
	"pool_id" text,
	"tx_hash" text,
	"activity_id" text,
	"chain" text,
	"fee_distribution" jsonb,
	"deployed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_token_launches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"stage" text,
	"company_website_url" text,
	"business_summary" text,
	"traction_summary" text,
	"launch_rationale" text,
	"social_links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_name" text,
	"token_symbol" text,
	"token_description" text,
	"image_url" text,
	"tweet_url" text,
	"token_website_url" text,
	"selected_fee_wallet_address" text,
	"latest_simulation_fingerprint" text,
	"latest_simulation" jsonb,
	"latest_simulation_at" timestamp with time zone,
	"deployed_token_address" text,
	"deployed_pool_id" text,
	"deployed_tx_hash" text,
	"deployed_activity_id" text,
	"deployed_chain" text,
	"deployed_fee_distribution" jsonb,
	"deployed_at" timestamp with time zone,
	"deployment_unknown_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_token_launch_requests" ADD CONSTRAINT "company_token_launch_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_token_launch_requests" ADD CONSTRAINT "company_token_launch_requests_launch_id_company_token_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."company_token_launches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_token_launch_requests" ADD CONSTRAINT "company_token_launch_requests_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_token_launches" ADD CONSTRAINT "company_token_launches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_token_launch_requests_approval_uq" ON "company_token_launch_requests" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "company_token_launch_requests_company_created_idx" ON "company_token_launch_requests" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "company_token_launch_requests_launch_created_idx" ON "company_token_launch_requests" USING btree ("launch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_token_launch_requests_company_deployed_uq" ON "company_token_launch_requests" USING btree ("company_id") WHERE "company_token_launch_requests"."token_address" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "company_token_launches_company_uq" ON "company_token_launches" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_token_launches_company_deployed_idx" ON "company_token_launches" USING btree ("company_id","deployed_token_address");
