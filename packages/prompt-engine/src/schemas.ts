import { z } from 'zod'

/**
 * Canvas LLM 输出 zod schema 第一批。
 *
 * 字段集与 `packages/canvas-engine/src/schema.ts` 的 `validateCharacterProfile` /
 * `validateLocationProfile` 对齐（只是把命令式校验改成声明式 schema）。
 *
 * 设计策略（lenient-tolerant，与 canvas-engine 保持一致）：
 *   - 进入 DB insert 的核心字段（character.name / identityPrompt；location.name / scenePrompt）→ 必填。
 *   - 描述性 / 嵌套 / 可选字段 → 默认值或 optional。
 *   - 用 `.loose()` 让 LLM 多返回的字段透传（不强制 strip），避免 schema 滞后于 prompt。
 *
 * 本轮仅提供 schema；调用方迁移（如 `packages/canvas-runtime/src/phases/{characters,locations}.ts`）
 * 留给独立任务（需要 canvas-runtime 内置 zod schema + 评估是否替换既有 validateX）。
 */

// ── Character ──────────────────────────────────────────────────────────────

const characterFaceSchema = z.object({
  shape: z.string().optional(),
  eyes: z.string().optional(),
  eyebrows: z.string().optional(),
  nose: z.string().optional(),
  mouth: z.string().optional(),
  skin: z.string().optional(),
}).loose()

const characterHairSchema = z.object({
  color: z.string().optional(),
  style: z.string().optional(),
  length: z.string().optional(),
}).loose()

const characterCostumeSchema = z.object({
  mainColor: z.string().optional(),
  style: z.string().optional(),
  material: z.string().optional(),
  details: z.array(z.string()).optional(),
}).loose()

export const canvasCharacterSchema = z.object({
  name: z.string(),
  role: z.string().optional(),
  age: z.string().optional(),
  gender: z.string().optional(),
  bodyShape: z.string().optional(),
  height: z.string().optional(),
  face: characterFaceSchema.optional(),
  hair: characterHairSchema.optional(),
  costume: characterCostumeSchema.optional(),
  accessories: z.array(z.string()).optional(),
  identityPrompt: z.string(),
  negativePrompt: z.string().optional(),
}).loose()

export type CanvasCharacter = z.infer<typeof canvasCharacterSchema>

// ── Location ───────────────────────────────────────────────────────────────

const locationVisualRulesSchema = z.object({
  colorPalette: z.array(z.string()).optional(),
  lighting: z.string().optional(),
  architecture: z.string().optional(),
  floor: z.string().optional(),
  backgroundElements: z.array(z.string()).optional(),
}).loose()

const locationCameraRulesSchema = z.object({
  axisDirection: z.string().optional(),
  allowedAngles: z.array(z.string()).optional(),
  forbiddenAngles: z.array(z.string()).optional(),
}).loose()

export const canvasLocationSchema = z.object({
  name: z.string(),
  type: z.enum(['interior', 'exterior', 'mixed']).optional(),
  location: z.string().optional(),
  era: z.string().optional(),
  atmosphere: z.string().optional(),
  visualRules: locationVisualRulesSchema.optional(),
  cameraRules: locationCameraRulesSchema.optional(),
  scenePrompt: z.string(),
  negativePrompt: z.string().optional(),
}).loose()

export type CanvasLocation = z.infer<typeof canvasLocationSchema>
