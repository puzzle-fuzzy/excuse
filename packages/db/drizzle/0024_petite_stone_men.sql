ALTER TYPE "public"."audit_action" ADD VALUE 'canvas_apply_reference_assets' BEFORE 'gateway_call';--> statement-breakpoint
ALTER TABLE "canvas_assets" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_records" ADD COLUMN "hidden_at" timestamp with time zone;