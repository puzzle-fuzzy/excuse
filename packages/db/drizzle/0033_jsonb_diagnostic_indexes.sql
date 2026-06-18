CREATE INDEX IF NOT EXISTS "idx_canvas_shots_ref_assets_gin" ON "canvas_shots" USING gin ("reference_assets_json" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gen_records_account_source" ON "generation_records" USING btree ("account_id",(input_params->>'source'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gen_records_input_project" ON "generation_records" USING btree ((input_params->>'projectId'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gen_records_input_worker_task" ON "generation_records" USING btree ((input_params->>'workerTaskId'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gen_records_input_pipeline_run" ON "generation_records" USING btree ((input_params->>'pipelineRunId'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gen_records_input_gin" ON "generation_records" USING gin ("input_params");