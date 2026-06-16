ALTER TABLE "canvas_assets" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_records" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "uploaded_files" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_canvas_assets_deleted_at" ON "canvas_assets" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_gen_records_deleted_at" ON "generation_records" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "idx_uploaded_files_deleted_at" ON "uploaded_files" USING btree ("deleted_at");