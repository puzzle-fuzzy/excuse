DO $$ BEGIN
  CREATE TYPE "public"."provider_model_health_status" AS ENUM('healthy', 'degraded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_model_health" (
	"model" varchar(100) PRIMARY KEY NOT NULL,
	"status" "provider_model_health_status" DEFAULT 'healthy' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"total_failures" integer DEFAULT 0 NOT NULL,
	"total_successes" integer DEFAULT 0 NOT NULL,
	"degraded_until" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_message" text,
	"degraded_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_provider_model_health_status" ON "provider_model_health" USING btree ("status","degraded_until");
