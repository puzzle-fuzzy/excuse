-- Phase 11 assemble：canvas_projects 新增最终合成视频 URL
-- 见 docs/TODO.md §二、2

ALTER TABLE "canvas_projects" ADD COLUMN IF NOT EXISTS "final_video_url" text;
