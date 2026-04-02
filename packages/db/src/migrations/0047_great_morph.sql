CREATE TABLE "stripe_project_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stripe_project_name" text NOT NULL,
	"stripe_project_dir" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_provisioned_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_service" text NOT NULL,
	"provider" text NOT NULL,
	"service_type" text NOT NULL,
	"tier" text,
	"status" text DEFAULT 'active' NOT NULL,
	"resource_metadata" jsonb,
	"provisioned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stripe_project_connections" ADD CONSTRAINT "stripe_project_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_project_connections" ADD CONSTRAINT "stripe_project_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_provisioned_services" ADD CONSTRAINT "stripe_provisioned_services_connection_id_stripe_project_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."stripe_project_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_project_connections_company_idx" ON "stripe_project_connections" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_project_connections_company_project_uq" ON "stripe_project_connections" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "stripe_provisioned_services_connection_idx" ON "stripe_provisioned_services" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "stripe_provisioned_services_connection_provider_service_idx" ON "stripe_provisioned_services" USING btree ("connection_id","provider_service");