ALTER TABLE "generation_records" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_records" ADD COLUMN "provider_cancel_status" varchar(50) DEFAULT 'not_requested' NOT NULL;
