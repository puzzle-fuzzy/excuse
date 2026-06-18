DROP INDEX "idx_gen_records_locked_until";--> statement-breakpoint
DROP INDEX "idx_gen_records_next_poll_at";--> statement-breakpoint
DROP INDEX "idx_subtitle_projects_locked_until";--> statement-breakpoint
DROP INDEX "idx_subtitle_projects_next_poll_at";--> statement-breakpoint
ALTER TABLE "generation_records" DROP COLUMN "locked_by";--> statement-breakpoint
ALTER TABLE "generation_records" DROP COLUMN "locked_until";--> statement-breakpoint
ALTER TABLE "generation_records" DROP COLUMN "provider_failure_count";--> statement-breakpoint
ALTER TABLE "generation_records" DROP COLUMN "next_poll_at";--> statement-breakpoint
ALTER TABLE "subtitle_projects" DROP COLUMN "locked_by";--> statement-breakpoint
ALTER TABLE "subtitle_projects" DROP COLUMN "locked_until";--> statement-breakpoint
ALTER TABLE "subtitle_projects" DROP COLUMN "provider_failure_count";--> statement-breakpoint
ALTER TABLE "subtitle_projects" DROP COLUMN "next_poll_at";