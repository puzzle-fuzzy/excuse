CREATE TABLE IF NOT EXISTS "subject_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"subject_type" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"identity_prompt" text,
	"negative_prompt" text,
	"scene_prompt" text,
	"profile_json" jsonb,
	"reference_image_url" text,
	"turnaround_sheet_url" text,
	"source_project_id" uuid,
	"source_entity_id" uuid,
	"tags" text[],
	"is_favorite" boolean DEFAULT false NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_subject_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL REFERENCES "canvas_projects"("id"),
	"subject_id" uuid NOT NULL REFERENCES "subject_library"("id"),
	"override_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_subject_library_user_type" ON "subject_library" USING btree ("account_id","subject_type");--> statement-breakpoint
CREATE INDEX "idx_subject_library_tags" ON "subject_library" USING gin ("tags");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_project_subject_unique" ON "project_subject_refs" USING btree ("project_id","subject_id");
