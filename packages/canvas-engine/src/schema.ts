import type {
  CharacterProfile,
  LocationProfile,
  NovelAnalysis,
  ShotDraft,
} from '@excuse/shared'
/**
 * Canvas LLM 输出 schema 校验器（纯函数，不调用 LLM/DB/provider）
 *
 * 配合 `@excuse/prompt-engine` 的 `parseLLMJson` 使用：
 *   parseLLMJson 只保证从 LLM 文本中抠出 JSON，不做字段校验（docstring 明确要求调用方自校验）。
 *   这里的校验器把 `unknown` 收窄为带类型的领域对象，拒绝垃圾数据、补默认值。
 *
 * 校验策略（lenient-tolerant）：
 *   - 直接进入 DB insert / 喂给下游生成器的字段 → 必填，缺失或类型错误抛 CanvasSchemaError
 *   - 描述性 / 嵌套 / 可选字段 → 缺失时填合理默认值，容忍 LLM 正常抖动
 *
 * 实现细节：4 个对外 validate 函数的内部由 zod schema 驱动；schema 用
 * `preprocess + .default()` 复刻既有「缺失字段（含 null / 类型不符）填充默认值」语义，
 * 保证返回对象始终完全填充（`profile.face.shape` 永远是 string 而非 undefined）。
 *
 * 注意 zod 的 `.default(literal)` 在字段缺失时直接返回字面量、不再跑内层 schema，
 * 所以嵌套对象的默认值必须预先填好全字段（见 FACE_DEFAULT / HAIR_DEFAULT 等），
 * 否则会出现 `face: {}` 这种内层字段缺失的情况。
 *
 * 参考 `./continuity.ts` 的纯领域函数风格：仅依赖 `@excuse/shared` 类型。
 */
import { z } from 'zod'

/** Canvas LLM 输出不符合 schema 时抛出，携带字段名与原因，便于上游 catch 后回传给用户 */
export class CanvasSchemaError extends Error {
  field: string
  reason: string
  constructor(field: string, reason: string) {
    super(`canvas schema: ${field} ${reason}`)
    this.name = 'CanvasSchemaError'
    this.field = field
    this.reason = reason
  }
}

/** 把 zod safeParse 失败结果转换为 CanvasSchemaError，保留 field/reason 契约 */
function throwSchemaError(
  result: { success: false, error: z.ZodError },
  prefix = '',
): never {
  const issue = result.error.issues[0]
  if (!issue)
    throw new CanvasSchemaError(prefix || '(root)', '校验失败')
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
  throw new CanvasSchemaError(
    prefix ? `${prefix}.${path}` : path,
    issue.message,
  )
}

// ── 复刻 optXxx 语义的 zod 构造块 ─────────────────────────────────────────────

/**
 * 可选字符串 — 非字符串（含 null / number / 缺失）一律填默认值 ''。
 * zod 的 `.default('')` 只在输入为 undefined 时触发，所以需要 preprocess
 * 把任何非字符串归一为 undefined。
 */
const optString = z.preprocess(
  v => (typeof v === 'string' ? v : undefined),
  z.string().default(''),
)

/**
 * 可选字符串数组 — 非数组填 []；数组则过滤掉非字符串元素（与 optStringArray 一致）。
 */
const optStringArray = z.preprocess(
  v => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined),
  z.array(z.string()).default([]),
)

/**
 * 可选数字 — 非有限数字填 0。
 */
const optNumber = z.preprocess(
  v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined),
  z.number().default(0),
)

/**
 * 嵌套对象字段：非 record（含 null / 数组 / 原始值 / 缺失）→ 返回预设的满默认值。
 * preprocess 把非 record 归一为 undefined，`.default(def)` 在 undefined 时填入 def。
 * 注意：def 必须是预先填好全字段的默认对象（zod 的 .default 不跑内层 schema）。
 */
function optRecord<T extends z.ZodTypeAny>(schema: T, def: z.output<T>) {
  return z.preprocess(
    v => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : undefined),
    schema.default(def as never),
  )
}

// ── NovelAnalysis ────────────────────────────────────────────────────────────

const novelAnalysisSchema = z.object({
  summary: z.string(),
  mainConflict: z.string(),
  timeline: optStringArray,
  characterNames: optStringArray,
  sceneNames: optStringArray,
})

/** 校验并归一化 NovelAnalysis（小说分析，整个 pipeline 的根） */
export function validateNovelAnalysis(input: unknown): NovelAnalysis {
  const result = novelAnalysisSchema.safeParse(input)
  if (!result.success)
    throwSchemaError(result, 'analysis')
  return result.data as NovelAnalysis
}

// ── CharacterProfile ─────────────────────────────────────────────────────────

const FACE_DEFAULT = { shape: '', eyes: '', eyebrows: '', nose: '', mouth: '', skin: '' }
const HAIR_DEFAULT = { color: '', style: '', length: '' }
const COSTUME_DEFAULT = { mainColor: '', style: '', material: '', details: [] as string[] }

const faceSchema = z.object({
  shape: optString,
  eyes: optString,
  eyebrows: optString,
  nose: optString,
  mouth: optString,
  skin: optString,
})

const hairSchema = z.object({
  color: optString,
  style: optString,
  length: optString,
})

const costumeSchema = z.object({
  mainColor: optString,
  style: optString,
  material: optString,
  details: optStringArray,
})

const characterProfileSchema = z.object({
  name: z.string(),
  role: optString,
  age: optString,
  gender: optString,
  bodyShape: optString,
  height: optString,
  face: optRecord(faceSchema, FACE_DEFAULT),
  hair: optRecord(hairSchema, HAIR_DEFAULT),
  costume: optRecord(costumeSchema, COSTUME_DEFAULT),
  accessories: optStringArray,
  identityPrompt: z.string(),
  negativePrompt: optString,
})

/** 校验并归一化 CharacterProfile（角色档案） */
export function validateCharacterProfile(input: unknown): CharacterProfile {
  const result = characterProfileSchema.safeParse(input)
  if (!result.success)
    throwSchemaError(result, 'character')
  return result.data as CharacterProfile
}

// ── LocationProfile ──────────────────────────────────────────────────────────

const VISUAL_RULES_DEFAULT = {
  colorPalette: [] as string[],
  lighting: '',
  architecture: '',
  floor: '',
  backgroundElements: [] as string[],
}
const CAMERA_RULES_DEFAULT = {
  axisDirection: '',
  allowedAngles: [] as string[],
  forbiddenAngles: [] as string[],
}

const visualRulesSchema = z.object({
  colorPalette: optStringArray,
  lighting: optString,
  architecture: optString,
  floor: optString,
  backgroundElements: optStringArray,
})

const cameraRulesSchema = z.object({
  axisDirection: optString,
  allowedAngles: optStringArray,
  forbiddenAngles: optStringArray,
})

const locationTypeEnum = z.enum(['interior', 'exterior', 'mixed'])

const locationProfileSchema = z.object({
  name: z.string(),
  type: z.preprocess(
    v => (locationTypeEnum.options.includes(v as never) ? v : undefined),
    locationTypeEnum.default('mixed'),
  ),
  location: optString,
  era: optString,
  atmosphere: optString,
  visualRules: optRecord(visualRulesSchema, VISUAL_RULES_DEFAULT),
  cameraRules: optRecord(cameraRulesSchema, CAMERA_RULES_DEFAULT),
  scenePrompt: z.string(),
  negativePrompt: optString,
})

/** 校验并归一化 LocationProfile（场景档案） */
export function validateLocationProfile(input: unknown): LocationProfile {
  const result = locationProfileSchema.safeParse(input)
  if (!result.success)
    throwSchemaError(result, 'location')
  return result.data as LocationProfile
}

// ── ShotDraft ────────────────────────────────────────────────────────────────

const SHOT_CAMERA_DEFAULT = { shotSize: '', angle: '', movement: '', lens: '' }
const SHOT_CONTINUITY_DEFAULT = {
  screenDirection: '',
  characterFacing: {} as Record<string, string>,
  actionStart: '',
  actionEnd: '',
  emotionStart: '',
  emotionEnd: '',
}

const shotCameraSchema = z.object({
  shotSize: optString,
  angle: optString,
  movement: optString,
  lens: optString,
})

/** characterFacing: Record<string, string>；过滤非字符串 value；非对象 → {} */
const characterFacingSchema = z.preprocess((v) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string')
      out[k] = val
  }
  return out
}, z.record(z.string(), z.string()))

const shotContinuitySchema = z.object({
  screenDirection: optString,
  characterFacing: optRecord(characterFacingSchema, {}),
  actionStart: optString,
  actionEnd: optString,
  emotionStart: optString,
  emotionEnd: optString,
})

const shotTimelineEntrySchema = z.object({
  time: optString,
  action: optString,
})

/** timeline: 非数组或全无效 → undefined */
const shotTimelineField = z.preprocess((v) => {
  if (!Array.isArray(v))
    return undefined
  const out = v
    .filter((e): e is Record<string, unknown> =>
      typeof e === 'object' && e !== null && !Array.isArray(e))
    .map(e => ({
      time: typeof e.time === 'string' ? e.time : '',
      action: typeof e.action === 'string' ? e.action : '',
    }))
  return out.length > 0 ? out : undefined
}, z.array(shotTimelineEntrySchema).optional())

/** environment: 非对象 → undefined；对象内非字符串 value → undefined */
const shotEnvironmentField = z.preprocess((v) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    return undefined
  const rec = v as Record<string, unknown>
  return {
    backgroundMotion: typeof rec.backgroundMotion === 'string' ? rec.backgroundMotion : undefined,
    lighting: typeof rec.lighting === 'string' ? rec.lighting : undefined,
    mood: typeof rec.mood === 'string' ? rec.mood : undefined,
    style: typeof rec.style === 'string' ? rec.style : undefined,
  }
}, z.object({
  backgroundMotion: z.string().optional(),
  lighting: z.string().optional(),
  mood: z.string().optional(),
  style: z.string().optional(),
}).optional())

/**
 * 单镜头 schema — shotIndex 经 preprocess 归一为 finite number | undefined，
 * 数组层 transform 再用 index 兜底（复刻既有「缺失 shotIndex 时回退到数组下标」语义）。
 */
const shotDraftSchema = z.object({
  shotIndex: z.preprocess(
    v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined),
    z.number().optional(),
  ),
  duration: optNumber,
  locationId: z.preprocess(
    v => (typeof v === 'string' ? v : null),
    z.string().nullable(),
  ),
  characterIds: optStringArray,
  narrative: z.string(),
  camera: optRecord(shotCameraSchema, SHOT_CAMERA_DEFAULT),
  continuity: optRecord(shotContinuitySchema, SHOT_CONTINUITY_DEFAULT),
  timeline: shotTimelineField,
  environment: shotEnvironmentField,
})

const shotDraftsSchema = z.array(shotDraftSchema)
  .min(1, '不能为空数组')
  .transform(shots => shots.map((shot, index) =>
    shot.shotIndex === undefined ? { ...shot, shotIndex: index } : shot,
  )) as unknown as z.ZodType<ShotDraft[]>

/** 校验并归一化分镜草案数组（storyboard LLM 输出） */
export function validateShotDrafts(input: unknown): ShotDraft[] {
  const result = shotDraftsSchema.safeParse(input)
  if (!result.success)
    throwSchemaError(result, 'shots')
  return result.data
}
