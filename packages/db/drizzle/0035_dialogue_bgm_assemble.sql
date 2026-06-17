-- 对话式音视频 + BGM + 合成：新增流水线阶段和 shot 数据模型扩展
-- 见 docs/TODO.md §二、2

-- 修改流水线阶段枚举，新增 dialogue / bgm / assemble
ALTER TYPE "canvas_pipeline_phase" ADD VALUE 'dialogue' BEFORE 'videos';--> statement-breakpoint
ALTER TYPE "canvas_pipeline_phase" ADD VALUE 'bgm' AFTER 'videos';--> statement-breakpoint
ALTER TYPE "canvas_pipeline_phase" ADD VALUE 'assemble' AFTER 'bgm';--> statement-breakpoint

-- canvas_shots 新增对话层字段
ALTER TABLE "canvas_shots" ADD COLUMN IF NOT EXISTS "dialogue_prompt" text;--> statement-breakpoint
ALTER TABLE "canvas_shots" ADD COLUMN IF NOT EXISTS "dialogue_json" jsonb;--> statement-breakpoint
ALTER TABLE "canvas_shots" ADD COLUMN IF NOT EXISTS "reference_media" jsonb;--> statement-breakpoint

-- canvas_projects 新增 BGM 字段
ALTER TABLE "canvas_projects" ADD COLUMN IF NOT EXISTS "bgm_url" text;
