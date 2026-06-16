CREATE TYPE "public"."provider_model_health_status" AS ENUM('healthy', 'degraded');--> statement-breakpoint
CREATE TABLE "provider_model_health" (
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
CREATE INDEX "idx_provider_model_health_status" ON "provider_model_health" USING btree ("status","degraded_until");
