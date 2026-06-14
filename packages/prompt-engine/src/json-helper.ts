import type { ZodError, ZodSchema } from 'zod'

/**
 * 从 LLM 输出中解析 JSON
 *
 * 1. 去除 markdown 代码块包裹
 * 2. 尝试直接解析
 * 3. 用非贪婪正则提取第一个完整 JSON 结构
 *
 * 注意：返回值仅通过 `as T` 类型断言，调用方应自行校验关键字段。
 * LLM 输出不可靠，对关键数据建议在调用处做字段校验。
 *
 * 推荐新代码改用 `parseLLMJsonWithSchema(raw, schema)`，由 zod 做 runtime 校验。
 */
export function parseLLMJson<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim()

  // Try parsing the entire cleaned text first (common case: clean JSON output)
  try {
    return JSON.parse(cleaned) as T
  }
  catch {
    // Not clean JSON — try extracting from surrounding text
  }

  // Determine which type to try first based on first significant character
  const firstChar = cleaned.match(/[{[]/)?.[0]
  // 非贪婪匹配：找到第一个匹配的完整 JSON（避免贪婪 [\s\S]* 吞掉多个 JSON 对象）
  const patterns = firstChar === '['
    ? [/\[[\s\S]*?\]/, /\{[\s\S]*?\}/]
    : [/\{[\s\S]*?\}/, /\[[\s\S]*?\}/]

  for (const pattern of patterns) {
    // 用 match + 循环尝试所有匹配位置（非贪婪可能有多个候选）
    const matches = cleaned.match(new RegExp(pattern.source, 'g'))
    if (matches) {
      for (const candidate of matches) {
        try {
          return JSON.parse(candidate) as T
        }
        catch {
          continue
        }
      }
    }
  }

  throw new Error(`Failed to extract JSON from LLM output: ${raw.slice(0, 200)}`)
}

/**
 * LLM 输出 JSON 通过 parseLLMJson 提取后，未通过 zod schema 校验时抛出。
 *
 * 携带 `zodError`（含 issues）和 `rawPreview`（原始文本前 200 字符），便于上层
 * 在 SSE / 日志中向用户暴露具体字段路径而不只是「LLM 输出错误」。
 */
export class LLMSchemaValidationError extends Error {
  readonly zodError: ZodError
  readonly rawPreview: string

  constructor(zodError: ZodError, rawPreview: string, message?: string) {
    super(message ?? `LLM output failed schema validation (raw preview: ${rawPreview})`)
    this.name = 'LLMSchemaValidationError'
    this.zodError = zodError
    this.rawPreview = rawPreview
  }
}

/**
 * 从 LLM 输出中解析 JSON 并用 zod schema 做运行时校验。
 *
 * 与 `parseLLMJson<T>` 的区别：
 *   - `parseLLMJson` 用裸 `as T` 强转，调用方需手动调 validateX；
 *   - `parseLLMJsonWithSchema` 内部调 `schema.parse`，失败抛 `LLMSchemaValidationError`。
 *
 * 推荐所有 Canvas / Generation 等 LLM 输出 parse 用本函数。
 *
 * 流程：
 *   1. 调 `parseLLMJson<unknown>(raw)` 沿用既有 markdown / 正则提取逻辑。
 *   2. 调 `schema.safeParse(json)`：
 *      - 成功 → 返回 typed value。
 *      - 失败 → 抛 `LLMSchemaValidationError`（含 zodError + raw 前 200 字）。
 *
 * 注意：
 *   - 非 JSON 输入（提取失败）会先抛既有 `Failed to extract JSON` 错误（沿用 parseLLMJson）。
 *   - 调用方可用 `instanceof LLMSchemaValidationError` 区分 schema 错误 vs JSON 解析错误。
 */
export function parseLLMJsonWithSchema<T>(raw: string, schema: ZodSchema<T>): T {
  const json = parseLLMJson<unknown>(raw)
  const result = schema.safeParse(json)
  if (!result.success) {
    throw new LLMSchemaValidationError(result.error, raw.slice(0, 200))
  }
  return result.data
}
