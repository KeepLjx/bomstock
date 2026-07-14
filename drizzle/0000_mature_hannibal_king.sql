CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_demands" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"material_code" text NOT NULL,
	"material_name" text,
	"spec" text,
	"required_qty" double precision NOT NULL,
	"source_sheet" text,
	"source_row_no" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"status" text DEFAULT 'parsed' NOT NULL,
	"files" jsonb,
	"config" jsonb,
	"summary" jsonb,
	"result" jsonb,
	"output_file_name" text,
	"error" text,
	"job_type" text,
	"uploaded_by" text,
	"file_hash" text,
	"biz_key" text,
	"sets" integer,
	"deduction_status" text DEFAULT 'active',
	"duplicate_of_job_id" text,
	"replaced_by_job_id" text,
	"reserved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"stored_name" text NOT NULL,
	"original_name" text,
	"meta" jsonb,
	"uploaded_by" text,
	"resource_type" text,
	"file_hash" text,
	"is_current" boolean,
	"effective_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"material_code" text NOT NULL,
	"material_name" text,
	"spec" text,
	"on_hand_qty" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE INDEX "bom_demands_material_code_idx" ON "bom_demands" USING btree ("material_code");--> statement-breakpoint
CREATE INDEX "bom_demands_job_id_idx" ON "bom_demands" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "bom_demands_material_job_idx" ON "bom_demands" USING btree ("material_code","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_resources_current_inventory_idx" ON "bom_resources" USING btree ("is_current") WHERE is_current = true AND resource_type = 'inventory';--> statement-breakpoint
CREATE INDEX "inventory_snapshots_material_code_idx" ON "inventory_snapshots" USING btree ("material_code");--> statement-breakpoint
CREATE INDEX "inventory_snapshots_resource_id_idx" ON "inventory_snapshots" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_token_hash_idx" ON "user_sessions" USING btree ("token_hash");