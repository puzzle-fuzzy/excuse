CREATE TABLE "asset_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"source" varchar(32) NOT NULL,
	"asset_id" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idx_asset_favorites_unique" UNIQUE("account_id","source","asset_id")
);
--> statement-breakpoint
ALTER TABLE "asset_favorites" ADD CONSTRAINT "asset_favorites_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_asset_favorites_account" ON "asset_favorites" USING btree ("account_id","created_at");