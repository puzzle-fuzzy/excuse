ALTER TABLE "generation_records" ADD COLUMN IF NOT EXISTS "locked_by" varchar(100) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_records" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subtitle_projects" ADD COLUMN IF NOT EXISTS "locked_by" varchar(100) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "subtitle_projects" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gen_records_locked_until" ON "generation_records" USING btree ("locked_until");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subtitle_projects_locked_until" ON "subtitle_projects" USING btree ("locked_until");