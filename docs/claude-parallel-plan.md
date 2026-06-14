# Claude B 下一轮执行计划：成熟库 zod runtime 校验迁移第一批（packages/gateway + packages/prompt-engine）

更新时间：2026-06-15

本文给 Claude B 执行。Claude A 当前在处理 **P3.2 管理后台运营统计深化**（`packages/shared/src/admin.ts` + `packages/db/src/repositories/admin.repo.ts` + `apps/server/src/routes/admin.ts` + `apps/client/src/pages/Admin.tsx` 扩用户列表 + provider 指标 tab），Claude B 本轮推进 P4.1「成熟库优先使用」第 4 条「`zod` / `valibot` / `arktype`」第一批：把 `packages/gateway` 和 `packages/prompt-engine` 这两个「外部输入 → 类型化对象」边界从「裸 cast / 手写校验」改为 zod parse + 类型守卫。

不要碰 apps/client、apps/server、apps/worker、packages/metrics、packages/provider、packages/db、packages/shared、packages/canvas-runtime、Canvas 客户端、表单页面。

## 上轮复核结论（已通过）

上一轮 Claude B 完成并提交：

- `9b0a37a feat(metrics): add provider error rate + model latency metrics`
- `b3f5795 docs(changelog): backfill provider metrics commit hash`

复核结果：

- `packages/metrics/src/index.ts`：`MetricsCollector` 新增 `recordProviderCall(model, durationMs, success)`；`MetricsSnapshot` 新增 `providerCalls` 字段；durations 数组限 1000 样本 FIFO 截断。
- `packages/metrics/src/provider-derived.ts`：新建纯聚合函数 `aggregateProviderMetrics`（接 providerCalls → Prometheus metric family `excuse_provider_calls_total{model,status}` + `excuse_provider_latency_seconds{model,quantile}`）。
- `packages/metrics/src/prometheus.ts`：`snapshotToPrometheus` 内部合并 provider metrics。
- `packages/provider/src/dashscope-client.ts`：新增 module-level `registerProviderCallObserver` hook 机制（不依赖 `@excuse/metrics`，由 app 注入回调），三类 public 方法（chatCompletion / generateImage / submitVideoTask）在成功 / HTTP 错误 / 网络异常 / 业务失败路径埋点。
- `apps/server/src/services/metrics.ts` + `apps/server/src/index.ts`：启动时一次注册 observer。
- 补 packages/metrics provider-derived 单元测试 + packages/provider DashScopeClient observer hook 测试 + apps/server metrics-routes 测试。
- `bun run typecheck`：server / client / worker 三端通过。
- 暂存区零跨界。

保持上一轮的纪律。

## 本轮目标

推进 P4.1 第 4 条「`zod` / `valibot` / `arktype`」第一批：把 `packages/gateway` + `packages/prompt-engine` 的外部输入边界改为 zod parse。

当前状态：

- `packages/gateway/src/index.ts`（401 行）：是 OpenAI 兼容网关的纯规则包。关键函数：
  - `normalizeOpenAIChatRequest(request: OpenAIChatRequest)`：手写 `request.messages.filter(m => m.role === 'user')` + 内联取 `lastUserMessage.content` + 手写参数构造；类型信任 OpenAIChatRequest 接口（来自 `@excuse/shared`），但**route 层传入的是 Elysia 解析的 JSON，运行时可能是任意 shape**。
  - `aggregateGatewayUsage(records)` / `mapGatewayUsageItem(record)`：手写字段访问 `record.cost?.inputTokens ?? null`，类型信任 `GatewayUsageRecordInput`；route 层传入的是 `generation_records` 行的 JSON 字段反序列化结果，运行时同样可能是任意 shape。
  - `createOpenAIStreamChunk` / `createOpenAIChatResponse` / `createOpenAIModelsResponse`：内部构造已知 shape，输出端，本轮**不改**（输出构造不涉及外部输入 parse）。
  - `createOpenAIError` / `modelNotFoundError` 等 6 个工厂函数：纯字符串构造，本轮**不改**。
- `packages/prompt-engine/src/json-helper.ts`（49 行）：
  - `parseLLMJson<T>(raw: string): T`：去 markdown 包裹 + 尝试 JSON.parse + 正则提取 + **裸 `as T` 强转**（注释明确：「LLM 输出不可靠，对关键数据建议在调用处做字段校验」）。
  - 3 个调用方：
    - `apps/server/test/canvas-json-helper.test.ts`（测试，不影响）
    - `apps/server/src/modules/canvas/regenerate.ts`（runtime，2 处：`parseLLMJson + validateCharacterProfile` / `parseLLMJson + validateLocationProfile`）
  - 既有模式：调用方 `parseLLMJson` 拿到 `T` 后**手动调 `validateX`** 做字段校验（`validateCharacterProfile` / `validateLocationProfile` 在 `packages/canvas-runtime` 里）。
- `packages/gateway/test/index.test.ts` + `usage.test.ts`：既有测试覆盖工厂函数 + mapGatewayUsageItem + aggregateGatewayUsage，本轮扩 normalizeOpenAIChatRequest + zod schema 测试。
- `packages/prompt-engine/test/json-helper.test.ts`：既有测试覆盖 `parseLLMJson` 解析逻辑（11 条，commit: `9b0a37a` 之前的 baseline）。本轮扩 `parseLLMJsonWithSchema` 测试。

本轮要做的：

1. **`packages/gateway` — 引入 zod schema + 重构 normalizeOpenAIChatRequest**：
   - `zod` 已是 `apps/client` 依赖（Claude A 上轮引入）；本轮在 `packages/gateway` 添加 zod 依赖（`packages/gateway/package.json` 加 `zod` 到 dependencies）。
   - 新建 `packages/gateway/src/schemas.ts`：定义 `openaiChatRequestSchema`（messages 数组 + 可选 temperature/max_tokens/top_p/stream/model）+ `gatewayUsageRecordSchema`（mapGatewayUsageItem 输入校验）。
   - `normalizeOpenAIChatRequest` 改为先 `openaiChatRequestSchema.safeParse(request)`，失败则构造 `invalidParametersError(zodError.issues)`；成功后基于 parsed value 取 lastUserMessage.content 构造 `parameters`。
   - `mapGatewayUsageItem` 改为先 `gatewayUsageRecordSchema.safeParse(record)`，失败的字段降级到 null/0（不抛错，保持向后兼容；route 层传的是 DB 行反序列化，字段缺失应兜底）。
   - **保留对外 API 签名**：`normalizeOpenAIChatRequest(request: OpenAIChatRequest)` 参数类型不变，仍是 OpenAIChatRequest（来自 @excuse/shared），但内部用 zod 做运行时校验。
2. **`packages/prompt-engine` — 新增 `parseLLMJsonWithSchema`**：
   - 在 `packages/prompt-engine/package.json` 加 `zod` 依赖。
   - 新建 `packages/prompt-engine/src/schemas.ts`：声明 `canvasCharacterSchema` / `canvasLocationSchema`（如果时间允许，覆盖更多 Canvas 输出 schema），便于后续 `parseLLMJsonWithSchema(raw, canvasCharacterSchema)` 调用。
   - 在 `json-helper.ts` 新增 `parseLLMJsonWithSchema<T>(raw: string, schema: ZodSchema<T>): T`：
     - 内部先调既有 `parseLLMJson<unknown>(raw)` 拿到任意 JSON（沿用既有去 markdown / 正则提取逻辑）。
     - 再调 `schema.parse(unknown)`，失败抛 `LLMSchemaValidationError`（新建），含原始 raw 前 200 字符 + zod issues。
   - **保留既有 `parseLLMJson<T>` 原签名**（向后兼容现有调用方 + 测试）；新增 `parseLLMJsonWithSchema` 作为推荐 API。
3. **迁移 `apps/server/src/modules/canvas/regenerate.ts` 的 2 处调用**（**仅当 Claude A 没有同时改 regenerate.ts** — 边界检查；如果 Claude A 不动 modules/，则本步骤安全）：
   - 把 `validateCharacterProfile(parseLLMJson(result.output.text as string))` 改为 `parseLLMJsonWithSchema(result.output.text as string, canvasCharacterSchema)`。
   - 同理替换 `validateLocationProfile(parseLLMJson(...))`。
   - **但是 `validateCharacterProfile` / `validateLocationProfile` 来自 `packages/canvas-runtime`**，不能让 `packages/prompt-engine` 反向依赖 `packages/canvas-runtime`（这会破坏 dependency direction：prompt-engine 是 BASE 层，canvas-runtime 是 runtime 层）。
   - **解决方案**：本轮**不迁移 regenerate.ts 调用**，仅提供 `parseLLMJsonWithSchema` 工具；调用方迁移留给独立任务（需要 `canvas-runtime` 内置 zod schema，是另一个 PR）。regenerate.ts 维持现状。
   - 因此本步骤**仅做 packages/prompt-engine 内部**：新增 schema 文件 + 新增 helper + 单测。不动 apps/。
4. **补 packages/gateway 测试**：
   - 新建 `packages/gateway/test/schemas.test.ts`：覆盖 `openaiChatRequestSchema` + `gatewayUsageRecordSchema` 各种输入（合法 / 缺字段 / 类型错误 / 多余字段）。
   - 扩 `packages/gateway/test/index.test.ts`：覆盖 `normalizeOpenAIChatRequest` 在以下场景的行为：
     - 合法请求（messages 含 user）→ 返回 NormalizedOpenAIChatRequest。
     - messages 是 string（非数组）→ safeParse 失败 → invalidParametersError。
     - messages 数组但元素缺 role → safeParse 失败 → invalidParametersError。
     - 多余字段（如 unknown_param='foo'）→ 安全 strip。
     - temperature 是字符串而非数字 → safeParse 失败（OpenAI 规范要 number）。
   - 扩 `packages/gateway/test/usage.test.ts`：覆盖 `mapGatewayUsageItem` 在以下场景：
     - cost 字段为 null → inputTokens/outputTokens 兜底 null。
     - cost.inputTokens 是字符串 → safeParse 失败时降级到 null。
5. **补 packages/prompt-engine 测试**：
   - 扩 `packages/prompt-engine/test/json-helper.test.ts`：覆盖 `parseLLMJsonWithSchema`：
     - 合法 JSON + schema 通过 → 返回 typed value。
     - 合法 JSON + schema 失败 → 抛 LLMSchemaValidationError（含 issues + 原始 raw 前 200 字）。
     - 非 JSON 输入 → 抛既有「Failed to extract JSON」错误（沿用 parseLLMJson 行为）。
     - markdown 包裹 + schema 通过 → 返回 typed value。
   - 新建 `packages/prompt-engine/test/schemas.test.ts`：覆盖 `canvasCharacterSchema` / `canvasLocationSchema` 字段校验。
6. **更新 `docs/TODO.md`**：
   - P4.1 第 4 条「`zod` / `valibot` / `arktype`」下方追加完成说明（不删条目，P4.1 是持续推进项）。
7. **更新 `CHANGELOG.md`**：
   - 在 `[Unreleased]` 的 Changed 区追加本轮完成内容和 commit。

本轮不要处理：

- `packages/canvas-runtime` 的 LLM JSON parser（`validateCharacterProfile` / `validateLocationProfile` 等）的 zod 化 — 独立任务，需要先有 canvas-runtime 内的 schema；本轮只**在 prompt-engine 提供 schema + 工具**，不动 canvas-runtime。
- `apps/server/src/modules/canvas/regenerate.ts` 的调用迁移（依赖 canvas-runtime schema）。
- `apps/server/src/routes/openai-gateway.ts` route 层（除了间接经过 normalizeOpenAIChatRequest 的行为变化，不动 route 代码）。
- `packages/gateway` 之外的 packages。
- `packages/gateway` 内部输出构造函数（`createOpenAIStreamChunk` / `createOpenAIChatResponse` 等）— 输出端不需要 zod 校验。
- 错误工厂函数（`modelNotFoundError` 等）— 纯字符串构造，不需要 zod。
- Canvas 客户端、表单页面、Admin 后台（Claude A 在动）。
- Worker 运行时改动。
- DB schema / migration。

## 重要规则：完成后必须 commit

- 本轮 1 个 commit（hash 回填可以追一个 docs commit）。
- commit 前必须运行 `git status --short` 和 `git diff --name-only --cached`。
- 暂存区只能包含本任务文件，**绝对不要**混入 Claude A 的 apps/server/src/routes/admin.ts / apps/client/src/pages/Admin.tsx / packages/db/src/repositories/admin.repo.ts / packages/shared/src/admin.ts 文件。
- 完成说明写入 `docs/TODO.md` P4.1 第 4 条下方（追加一行，不删条目）。
- 完成记录和 commit 写入根目录 `CHANGELOG.md`。
- 如果 `docs/TODO.md` / `CHANGELOG.md` 与 Claude A 并行修改冲突，优先提交代码；文档冲突在最终回复里说明。
- commit 成功后，在最终回复里写出 commit hash。

**强制检查**：commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `apps/client/`（任何路径，本轮零 client 改动）
- `apps/server/`（任何路径，本轮零 server 改动）
- `apps/worker/`（任何路径，本轮零 worker 改动）
- `packages/shared/`（任何路径，Claude A 在动 admin DTO）
- `packages/db/`（任何路径，Claude A 在动 admin repo）
- `packages/metrics/`（任何路径）
- `packages/provider/`（任何路径）
- `packages/canvas-engine/` / `packages/canvas-runtime/`（任何路径）
- `packages/events/` / `packages/workflow-engine/` / `packages/task-engine/`（任何路径）
- `packages/rate-limit/` / `packages/subtitle-engine/` / `packages/auth/`（任何路径）
- `packages/billing/` / `packages/ffmpeg/` / `packages/storage/`（任何路径）

## 文件边界

Claude B 可以修改：

```txt
packages/gateway/package.json                                  (新增 zod 依赖)
packages/gateway/src/schemas.ts                                (新建：openaiChatRequestSchema + gatewayUsageRecordSchema)
packages/gateway/src/index.ts                                  (normalizeOpenAIChatRequest + mapGatewayUsageItem 改用 zod safeParse)
packages/gateway/test/schemas.test.ts                          (新建：schema 单元测试)
packages/gateway/test/index.test.ts                            (扩 normalizeOpenAIChatRequest zod 行为测试)
packages/gateway/test/usage.test.ts                            (扩 mapGatewayUsageItem 兜底测试)
packages/prompt-engine/package.json                            (新增 zod 依赖)
packages/prompt-engine/src/schemas.ts                          (新建：canvasCharacterSchema + canvasLocationSchema + 其他 LLM JSON schema)
packages/prompt-engine/src/json-helper.ts                      (新增 parseLLMJsonWithSchema + LLMSchemaValidationError；保留 parseLLMJson 原签名)
packages/prompt-engine/test/json-helper.test.ts                (扩 parseLLMJsonWithSchema 测试)
packages/prompt-engine/test/schemas.test.ts                    (新建：canvasCharacterSchema / canvasLocationSchema 测试)
bun.lock                                                      (依赖锁文件自然变更)
docs/TODO.md
CHANGELOG.md
```

Claude B 不要修改：

```txt
docs/claude-next-plan.md
apps/client/**                                                (本轮零 client 改动)
apps/server/**                                                (本轮零 server 改动，含 openai-gateway.ts route 文件)
apps/worker/**                                                (本轮零 worker 改动)
packages/shared/**                                            (Claude A 在动 admin DTO)
packages/db/**                                                (Claude A 在动 admin repo)
packages/metrics/**                                           (本轮零 metrics 改动)
packages/provider/**                                          (本轮零 provider 改动)
packages/canvas-engine/**                                     (本轮零 canvas-engine 改动)
packages/canvas-runtime/**                                    (本轮零 canvas-runtime 改动；schema 化留给独立任务)
packages/events/**
packages/workflow-engine/**
packages/task-engine/**
packages/rate-limit/**
packages/subtitle-engine/**
packages/auth/**
packages/billing/**
packages/ffmpeg/**
packages/storage/**
packages/gateway/src/streaming*                              (本轮不动 streaming 相关)
packages/prompt-engine/src/index.ts                           (barrel export 仅在新增 schema 文件时追加 export 一行)
packages/prompt-engine/src/prompts.ts                         (本轮不动)
packages/prompt-engine/src/prompt-builder.ts                  (本轮不动)
```

如果必须修改边界外文件，**先停止并在最终回复说明原因**。

## 第一步：调研现有 zod 用法 + 边界

阅读以下文件，记录现有结构和扩展点：

1. `packages/gateway/src/index.ts`（已读 401 行）— 重点关注：
   - `normalizeOpenAIChatRequest` 的 messages filter + lastUserMessage.content 取值逻辑。
   - `mapGatewayUsageItem` 的 cost / inputParams 访问模式。
   - `aggregateGatewayUsage` 的累加逻辑（可能也用 zod，但本身只是 reduction，不改）。
   - 工厂函数（`modelNotFoundError` 等）— 不动。
2. `packages/prompt-engine/src/json-helper.ts`（已读 49 行）— `parseLLMJson<T>` 完整实现 + 既有注释。
3. `packages/gateway/test/index.test.ts` — 既有测试结构（mock 模式、describe 组织）。
4. `packages/prompt-engine/test/json-helper.test.ts` — 既有测试结构。
5. `apps/client/package.json` — 确认 zod 版本（上轮 Claude A 装的是 `zod@4.4.3`）；本轮 packages/gateway 和 packages/prompt-engine 也用同版本。
6. `packages/canvas-runtime/src/`（grep `validateCharacterProfile` / `validateLocationProfile`）— 确认这两个 validate 函数的入参 shape（作为本轮 `canvasCharacterSchema` / `canvasLocationSchema` 的字段参考）。
7. `packages/shared/src/openai-gateway.ts` — 确认 `OpenAIChatRequest` / `OpenAIErrorResponse` 等 type 的字段定义（作为 `openaiChatRequestSchema` 的字段参考）。

调研结论写入最终回复。

## 第二步：在 packages/gateway 引入 zod schema

### 2a. 新建 packages/gateway/src/schemas.ts

```ts
import { z } from 'zod'

/**
 * OpenAI Chat Completions 请求的 zod schema。
 *
 * 用于 normalizeOpenAIChatRequest 的运行时校验：route 层传入的是 Elysia
 * 解析的 JSON，可能是任意 shape（比如客户端把 messages 传成 string、把
 * temperature 传成字符串）。zod safeParse 失败时，构造 invalidParametersError。
 *
 * 字段定义参考 @excuse/shared 的 OpenAIChatRequest type；zod schema 是
 * 运行时镜像，保持与 type 同步。
 */
export const openaiChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
})

export const openaiChatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(openaiChatMessageSchema).min(1),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().optional(),
  stream: z.boolean().optional(),
  // 其他 OpenAI 标准字段透传不报错（zod 默认 strip 多余字段）
}).passthrough()  // 允许透传 n / presence_penalty 等未声明字段给后续 mapping

export type OpenAIChatRequestParsed = z.infer<typeof openaiChatRequestSchema>

/**
 * mapGatewayUsageItem 输入记录的 zod schema。
 *
 * route 层从 generation_records 抽出 cost / inputParams 等字段后传给 gateway，
 * 但这些字段来自 DB JSONB，运行时可能是任意 shape（旧 record 可能字段缺失、
 * 字段类型可能错误）。zod safeParse 失败时，mapGatewayUsageItem 降级到 null/0
 * 而不是抛错（保持向后兼容）。
 */
export const gatewayUsageRecordSchema = z.object({
  id: z.string(),
  model: z.string(),
  status: z.enum(['pending', 'submitting', 'processing', 'saving_output', 'succeeded', 'failed', 'cancelled']),
  inputParams: z.object({
    requestedModel: z.unknown().optional(),
  }).nullable(),
  cost: z.object({
    inputTokens: z.number().nullable().optional(),
    outputTokens: z.number().nullable().optional(),
    totalPriceCents: z.number().nullable().optional(),
  }).nullable(),
  totalPriceCents: z.number().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.date(),  // route 层传 Date 对象
})

export type GatewayUsageRecordParsed = z.infer<typeof gatewayUsageRecordSchema>
```

注意：
- `.passthrough()` 让 OpenAI 请求里的 `n` / `presence_penalty` 等额外字段透传，不强制 strip；后续 normalize 后内部 mapping 只取已声明字段。
- zod 4.x 的 API（`z.string().email()` 等可能略有变化），调研时确认上轮 Claude A 用的 `zod@4.4.3` API；如果 `z.enum` / `z.object().passthrough()` 在 v4 改名（v4 把 `.passthrough()` 改成 `.loose({})` 或类似），调整写法。
- 不要 export schema 给外部包（schema 是 gateway 内部实现细节）。

### 2b. 重构 normalizeOpenAIChatRequest

修改 `packages/gateway/src/index.ts` 的 `normalizeOpenAIChatRequest`：

```ts
import { openaiChatRequestSchema } from './schemas'

export function normalizeOpenAIChatRequest(request: OpenAIChatRequest): NormalizedOpenAIChatRequest | OpenAIGatewayError {
  const parsed = openaiChatRequestSchema.safeParse(request)
  if (!parsed.success) {
    // zod issues → invalidParametersError
    const errors = parsed.error.issues.map(issue => ({
      field: issue.path.join('.') || '(root)',
      message: issue.message,
    }))
    return invalidParametersError(errors)
  }

  const value = parsed.data
  const userMessages = value.messages.filter(m => m.role === 'user')
  if (userMessages.length === 0) {
    return missingUserMessageError()
  }

  const lastUserMessage = userMessages[userMessages.length - 1]!
  const parameters: Record<string, unknown> = { prompt: lastUserMessage.content }
  if (value.temperature !== undefined) parameters.temperature = value.temperature
  if (value.max_tokens !== undefined) parameters.max_tokens = value.max_tokens
  if (value.top_p !== undefined) parameters.top_p = value.top_p

  return {
    request,  // 保留原始 request 供 route 引用（向后兼容）
    internalModelId: resolveModelId(value.model),
    prompt: lastUserMessage.content,
    parameters,
    stream: value.stream ?? false,
  }
}
```

注意：
- 返回值仍包含 `request: OpenAIChatRequest`（原始未 parse 的对象），保持向后兼容（route 可能访问 request 的其他字段）。
- 如果 zod parse 失败，构造 `invalidParametersError`，与既有 missing_user_message 行为一致（route 层已经处理 OpenAIGatewayError 联合类型）。
- 类型签名 `request: OpenAIChatRequest` 不变；zod 是运行时校验，type 是编译期约束。

### 2c. 重构 mapGatewayUsageItem（轻量）

修改 `mapGatewayUsageItem`，内部对 cost / inputParams 用 zod safeParse 做兜底：

```ts
import { gatewayUsageRecordSchema } from './schemas'

export function mapGatewayUsageItem(record: GatewayUsageRecordInput): OpenAIGatewayUsageItem {
  // 用 zod 做字段兜底（不抛错，仅 strip 非法字段）
  const parsed = gatewayUsageRecordSchema.safeParse(record)
  // 即使 parse 失败也继续：用 parsed.data ?? record fallback；让 mapGatewayUsageItem 永远返回有效 item
  const value = parsed.success ? parsed.data : record

  const cost = value.cost ?? null
  // ... 既有逻辑不变
}
```

注意：
- 这里不抛错；如果 record 字段缺失，沿用既有兜底逻辑（null / 0）。
- zod 的作用是**字段类型守卫**（防止 `cost.inputTokens` 是字符串让后续累加出错），不是请求拒绝。

## 第三步：在 packages/prompt-engine 引入 zod schema

### 3a. 新建 packages/prompt-engine/src/schemas.ts

```ts
import { z } from 'zod'

/**
 * Canvas 角色 schema。
 *
 * 字段参考 packages/canvas-runtime 的 validateCharacterProfile（grep 找）。
 * 与 validateCharacterProfile 的字段集保持一致；本轮**不删除** validateCharacterProfile，
 * 仅提供 zod schema 作为更严格的 runtime 校验入口。
 */
export const canvasCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  appearance: z.string(),
  personality: z.string().optional(),
  // ... 其他字段按 validateCharacterProfile 调研后补齐
})

export type CanvasCharacter = z.infer<typeof canvasCharacterSchema>

export const canvasLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  // ... 其他字段
})

export type CanvasLocation = z.infer<typeof canvasLocationSchema>
```

注意：
- 调研 `validateCharacterProfile` 实际字段后补齐；如果字段过多（10+），先做核心字段（id/name/role/appearance），其余 `.passthrough()`。
- schema 名要与 caller 期望一致；本轮不强制 caller（regenerate.ts）迁移，所以 schema 字段集只要能 cover 当前 Canvas analyze phase 输出即可。

### 3b. 在 json-helper.ts 新增 parseLLMJsonWithSchema

```ts
import type { ZodSchema } from 'zod'

export class LLMSchemaValidationError extends Error {
  constructor(
    public readonly zodError: unknown,  // ZodError
    public readonly rawPreview: string,
    message?: string,
  ) {
    super(message ?? `LLM output failed schema validation: ${rawPreview}`)
    this.name = 'LLMSchemaValidationError'
  }
}

/**
 * 从 LLM 输出中解析 JSON 并用 zod schema 校验。
 *
 * 与 parseLLMJson<T> 的区别：
 *   - parseLLMJson 用裸 as T 强转，调用方需手动调 validateX；
 *   - parseLLMJsonWithSchema 内部调 schema.parse，失败抛 LLMSchemaValidationError。
 *
 * 推荐所有 Canvas / Generation 等 LLM 输出 parse 用本函数。
 * 既有 parseLLMJson 保留，向后兼容。
 */
export function parseLLMJsonWithSchema<T>(raw: string, schema: ZodSchema<T>): T {
  const json = parseLLMJson<unknown>(raw)
  const result = schema.safeParse(json)
  if (!result.success) {
    throw new LLMSchemaValidationError(
      result.error,
      raw.slice(0, 200),
    )
  }
  return result.data
}
```

注意：
- `parseLLMJson` 完全不动（既有 caller + 测试不变）。
- 新函数返回类型 `T` 来自 `ZodSchema<T>`，不需要 `<T>` 显式标注。
- `LLMSchemaValidationError` 是新 error class；route / worker 层 catch 时可 instanceof 判断。
- import 用 `import type { ZodSchema }`（避免打包运行时依赖；类型擦除）。

## 第四步：扩 packages/gateway 测试

### 4a. 新建 packages/gateway/test/schemas.test.ts

```ts
import { describe, it, expect } from 'bun:test'
import { openaiChatRequestSchema, gatewayUsageRecordSchema } from '../src/schemas'

describe('openaiChatRequestSchema', () => {
  it('accepts valid request', () => {
    const valid = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
    }
    expect(openaiChatRequestSchema.safeParse(valid).success).toBe(true)
  })
  it('rejects non-array messages', () => {
    const invalid = { model: 'gpt-4', messages: 'foo' }
    expect(openaiChatRequestSchema.safeParse(invalid).success).toBe(false)
  })
  it('rejects message missing role', () => {
    const invalid = { model: 'gpt-4', messages: [{ content: 'hi' }] }
    expect(openaiChatRequestSchema.safeParse(invalid).success).toBe(false)
  })
  it('rejects string temperature', () => {
    const invalid = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: '0.5',
    }
    expect(openaiChatRequestSchema.safeParse(invalid).success).toBe(false)
  })
  it('allows unknown fields via passthrough', () => {
    const valid = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'hi' }],
      unknown_param: 'foo',
    }
    const result = openaiChatRequestSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) expect((result.data as Record<string, unknown>).unknown_param).toBe('foo')
  })
  it('rejects empty messages array', () => {
    const invalid = { model: 'gpt-4', messages: [] }
    expect(openaiChatRequestSchema.safeParse(invalid).success).toBe(false)
  })
})

describe('gatewayUsageRecordSchema', () => {
  it('accepts record with null cost', () => { /* ... */ })
  it('accepts record with partial cost', () => { /* ... */ })
  it('rejects record with string totalPriceCents', () => { /* ... */ })
})
```

### 4b. 扩 packages/gateway/test/index.test.ts — normalizeOpenAIChatRequest

追加 describe：

```ts
describe('normalizeOpenAIChatRequest with zod', () => {
  it('returns NormalizedOpenAIChatRequest on valid input', () => { /* ... */ })
  it('returns invalidParametersError when messages is string', () => {
    const result = normalizeOpenAIChatRequest({ model: 'gpt-4', messages: 'foo' } as unknown as OpenAIChatRequest)
    expect(isOpenAIGatewayError(result)).toBe(true)
    if (isOpenAIGatewayError(result)) {
      expect(result.status).toBe(400)
      expect(result.response.error.code).toBe('invalid_parameters')
    }
  })
  it('returns invalidParametersError when message missing role', () => { /* ... */ })
  it('returns missing_user_message when no user role in valid messages', () => { /* ... */ })
  it('strips invalid temperature type via zod (returns invalid_parameters)', () => { /* ... */ })
  it('preserves unknown params via passthrough on success path', () => { /* ... */ })
})
```

注意：
- 测试需 `as unknown as OpenAIChatRequest` cast 才能传非法 shape（绕过 TS 编译期类型）。
- 既有 normalizeOpenAIChatRequest 测试（missing_user_message / 多 user / stream=true）保持通过；本轮扩边界场景。

### 4c. 扩 packages/gateway/test/usage.test.ts — mapGatewayUsageItem 兜底

追加：

```ts
describe('mapGatewayUsageItem with malformed input', () => {
  it('returns null tokens when cost.inputTokens is string', () => {
    const malformed = { /* record with cost.inputTokens='foo' */ } as unknown as GatewayUsageRecordInput
    const item = mapGatewayUsageItem(malformed)
    expect(item.inputTokens).toBe(null)
  })
  it('preserves id even when cost is wrong shape', () => { /* ... */ })
})
```

## 第五步：扩 packages/prompt-engine 测试

### 5a. 扩 packages/prompt-engine/test/json-helper.test.ts — parseLLMJsonWithSchema

追加 describe：

```ts
import { z } from 'zod'
import { parseLLMJsonWithSchema, LLMSchemaValidationError } from '../src/json-helper'

describe('parseLLMJsonWithSchema', () => {
  const schema = z.object({ name: z.string(), value: z.number() })

  it('returns typed value on valid JSON', () => {
    const result = parseLLMJsonWithSchema('{"name":"foo","value":42}', schema)
    expect(result.name).toBe('foo')
    expect(result.value).toBe(42)
  })
  it('parses JSON wrapped in markdown fence', () => {
    const result = parseLLMJsonWithSchema('```json\n{"name":"foo","value":42}\n```', schema)
    expect(result.name).toBe('foo')
  })
  it('throws LLMSchemaValidationError on schema mismatch', () => {
    expect(() => parseLLMJsonWithSchema('{"name":"foo","value":"not a number"}', schema)).toThrow(LLMSchemaValidationError)
  })
  it('includes raw preview in error message', () => {
    const raw = '{"name":"foo","value":"x"} extra text'.repeat(10)
    try {
      parseLLMJsonWithSchema(raw, schema)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(LLMSchemaValidationError)
      expect((err as LLMSchemaValidationError).rawPreview.length).toBeLessThanOrEqual(200)
    }
  })
  it('throws base Error on non-JSON input (parseLLMJson behavior preserved)', () => {
    expect(() => parseLLMJsonWithSchema('no json here', schema)).toThrow('Failed to extract JSON')
  })
})
```

注意：
- 既有 `parseLLMJson` 测试全部保留（不动）；本 describe 是新增。
- 错误类型断言：`instanceof LLMSchemaValidationError` 而不是基类 Error。

### 5b. 新建 packages/prompt-engine/test/schemas.test.ts

```ts
import { describe, it, expect } from 'bun:test'
import { canvasCharacterSchema, canvasLocationSchema } from '../src/schemas'

describe('canvasCharacterSchema', () => {
  it('accepts full character', () => { /* ... */ })
  it('rejects missing id', () => { /* ... */ })
  it('rejects non-string name', () => { /* ... */ })
})

describe('canvasLocationSchema', () => {
  it('accepts full location', () => { /* ... */ })
  it('rejects missing name', () => { /* ... */ })
})
```

## 第六步：更新 TODO 和 CHANGELOG

修改 `docs/TODO.md`：

- P4.1 第 4 条「`zod` / `valibot` / `arktype`」下方追加一行（不删条目）：

```txt
   - ✅ packages/gateway（`normalizeOpenAIChatRequest` / `mapGatewayUsageItem` 引入 zod safeParse + 新建 `packages/gateway/src/schemas.ts`）+ packages/prompt-engine（新建 `parseLLMJsonWithSchema` + `LLMSchemaValidationError` + `packages/prompt-engine/src/schemas.ts`，保留 `parseLLMJson` 原签名）已完成第一批迁移（commit: `<本轮 hash>`）。canvas-runtime / regenerate.ts 调用迁移留待独立任务。
```

- 不要碰 P0 / P1 / P2 / P3 章节，避免与 Claude A 在 P3.2 admin 章节的修改撞行。
- 不要碰 P3.2 管理后台章节（Claude A 当前在动）。

修改根目录 `CHANGELOG.md`：

- 在 `[Unreleased]` 的 Changed 区追加：

```txt
- 客户端表单 + 外部输入边界 zod runtime 校验迁移第一批：`packages/gateway` 新增 `zod` 依赖（`zod@4.4.3`，与 apps/client 同版本），新建 `packages/gateway/src/schemas.ts` 提供 `openaiChatRequestSchema` + `gatewayUsageRecordSchema` 两个 zod schema；`normalizeOpenAIChatRequest` 改为先 `safeParse` 再走原 user-messages filter，parse 失败时构造 `invalidParametersError(zodError.issues)`，保留 `.passthrough()` 让未知 OpenAI 字段透传；`mapGatewayUsageItem` 对 cost/inputParams 做 zod safeParse 兜底（不抛错，仅类型守卫）；`packages/prompt-engine` 新增 `zod` 依赖，新建 `packages/prompt-engine/src/schemas.ts`（`canvasCharacterSchema` / `canvasLocationSchema`），`json-helper.ts` 新增 `parseLLMJsonWithSchema<T>(raw, schema): T` + `LLMSchemaValidationError`（保留 `parseLLMJson` 原签名与所有既有 caller / 测试不变，新 API 用于后续 canvas-runtime / regenerate.ts 迁移）；补 packages/gateway schemas + normalizeOpenAIChatRequest zod 行为 + usage 兜底测试 + packages/prompt-engine parseLLMJsonWithSchema + schemas 测试（commit: `<本轮 hash>`）。
```

- 写入本轮 commit 短 hash（commit 完成后回填）。

如果文档与 Claude A 冲突：

- 不要覆盖 Claude A 的 admin 后台记录。
- 可以先提交代码，文档冲突在最终回复里说明。

## 验证命令

至少运行：

```bash
bun test packages/gateway/test/schemas.test.ts
bun test packages/gateway/test/index.test.ts
bun test packages/gateway/test/usage.test.ts
bun test packages/prompt-engine/test/json-helper.test.ts
bun test packages/prompt-engine/test/schemas.test.ts
bun run --cwd packages/gateway typecheck
bun run --cwd packages/prompt-engine typecheck
```

如时间允许，再运行：

```bash
bun run typecheck  # 全仓三端 typecheck
bun run lint
bun test packages/gateway packages/prompt-engine
```

如果 server test 因 Claude A 并行未提交文件失败（`apps/server/test/admin-routes.test.ts` 等），不要修改 Claude A 文件；只跑 packages/ 内的测试即可。

## 推荐 commit

```bash
git add packages/gateway/package.json \
  packages/gateway/src/schemas.ts \
  packages/gateway/src/index.ts \
  packages/gateway/test/schemas.test.ts \
  packages/gateway/test/index.test.ts \
  packages/gateway/test/usage.test.ts \
  packages/prompt-engine/package.json \
  packages/prompt-engine/src/schemas.ts \
  packages/prompt-engine/src/json-helper.ts \
  packages/prompt-engine/test/json-helper.test.ts \
  packages/prompt-engine/test/schemas.test.ts \
  bun.lock \
  docs/TODO.md \
  CHANGELOG.md

git diff --name-only --cached
```

⚠️ 如果 `packages/prompt-engine/src/index.ts` barrel export 需要追加 `export * from './schemas'`，把该文件加入 add 列表；**仅限 export 一行追加**，不动其他 export。

**强制检查**：commit 前必须确认 `git diff --name-only --cached` 输出**不包含**：

- `apps/client/`（任何路径）
- `apps/server/`（任何路径，含 `routes/openai-gateway.ts`）
- `apps/worker/`（任何路径）
- `packages/shared/`（任何路径）
- `packages/db/`（任何路径）
- `packages/metrics/`（任何路径）
- `packages/provider/`（任何路径）
- `packages/canvas-engine/` / `packages/canvas-runtime/`（任何路径）
- `packages/events/` / `packages/workflow-engine/` / `packages/task-engine/`（任何路径）
- `packages/rate-limit/` / `packages/subtitle-engine/` / `packages/auth/`（任何路径）
- `packages/billing/` / `packages/ffmpeg/` / `packages/storage/`（任何路径）

确认无误后提交：

```bash
git commit -m "refactor(gateway,prompt-engine): introduce zod runtime schemas for external input"
```

最终回复必须包含：

- 本轮 commit hash。
- 实际运行的验证命令（特别是 packages/gateway + packages/prompt-engine test 输出）。
- `git diff --name-only --cached` 的最终输出（证明未跨界）。
- 第一步「调研」结果：zod 版本、OpenAIChatRequest 字段集、validateCharacterProfile 字段集（用于 canvasCharacterSchema）。
- 第二步 zod schema 设计：`.passthrough()` 用法 / safeParse 兜底策略。
- 第三步 `parseLLMJsonWithSchema` 设计：与既有 `parseLLMJson` 共存模式、LLMSchemaValidationError 字段。
- 一个真实测试 case 输出示例（如 normalizeOpenAIChatRequest 收到 `messages: 'foo'` 时返回 invalidParametersError 的完整 response shape）。
- 与 Claude A 是否有冲突（特别是 `docs/TODO.md` / `CHANGELOG.md`）。
