ALTER TABLE "generation_records" ADD COLUMN "provider_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_records" ADD COLUMN "next_poll_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subtitle_projects" ADD COLUMN "provider_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subtitle_projects" ADD COLUMN "next_poll_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_gen_records_next_poll_at" ON "generation_records" USING btree ("next_poll_at");--> statement-breakpoint
CREATE INDEX "idx_subtitle_projects_next_poll_at" ON "subtitle_projects" USING btree ("next_poll_at");