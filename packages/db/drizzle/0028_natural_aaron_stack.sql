ALTER TABLE "api_keys" ADD COLUMN "scope" varchar(20) DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "rate_limit_per_minute" integer;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "quota_max_cents" integer;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "total_spend_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "quota_reset_at" timestamp with time zone;