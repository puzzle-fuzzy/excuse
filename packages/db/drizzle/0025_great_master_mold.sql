ALTER TYPE "public"."audit_action" ADD VALUE 'file_update' BEFORE 'billing_transaction';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'asset_hide' BEFORE 'gateway_call';