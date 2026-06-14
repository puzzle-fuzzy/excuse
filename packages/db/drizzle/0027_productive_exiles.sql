CREATE TABLE "asset_tag_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"asset_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idx_asset_tag_assignments_unique" UNIQUE("account_id","tag_id","source","asset_id")
);
--> statement-breakpoint
CREATE TABLE "asset_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idx_asset_tags_account_name" UNIQUE("account_id","name")
);
--> statement-breakpoint
ALTER TABLE "asset_tag_assignments" ADD CONSTRAINT "asset_tag_assignments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tag_assignments" ADD CONSTRAINT "asset_tag_assignments_tag_id_asset_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."asset_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tags" ADD CONSTRAINT "asset_tags_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_asset_tag_assignments_account" ON "asset_tag_assignments" USING btree ("account_id","tag_id");--> statement-breakpoint
CREATE INDEX "idx_asset_tag_assignments_asset" ON "asset_tag_assignments" USING btree ("account_id","source","asset_id");--> statement-breakpoint
CREATE INDEX "idx_asset_tags_account" ON "asset_tags" USING btree ("account_id","created_at");