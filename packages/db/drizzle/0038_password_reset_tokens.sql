-- 密码重置令牌表：SHA-256 哈希、30 分钟一次性 token、不可枚举
-- 见 CLAUDE.md §Database / @excuse/auth

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_password_reset_account" ON "password_reset_tokens" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_password_reset_hash" ON "password_reset_tokens" USING btree ("token_hash");
