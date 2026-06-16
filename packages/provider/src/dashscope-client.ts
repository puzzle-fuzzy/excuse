import type { InputMapping, ModelConfig } from '@excuse/shared'
import type {
  DashScopeChatResponse,
  DashScopeChatStreamEvent,
  DashScopeImageResponse,
  DashScopeOpenaiChatResponse,
  DashScopeTaskQueryResponse,
  DashScopeUsage,
  DashScopeVideoSubmitResponse,
} from './dashscope-types'
import type { ValidatedModelParameters } from './model-validator'
import type {
  DashScopeConfig,
  DashScopeTaskOutput,
  FailedProviderResult,
  ImageProviderResult,
  ProviderResult,
  TaskStatus,
  TextProviderResult,
  TextStreamChunk,
  VideoTaskProviderResult,
} from './types'
import { parseDashScopeError } from './dashscope-errors'
import { getModelById } from './model-configs'

/**
 * Provider 调用观察者 —— 在 DashScope 调用结束（成功或失败）后被通知。
 *
 * 设计意图：
 * - `@excuse/provider` 不依赖 `@excuse/metrics`（runtime 包不能依赖 pure 单例）；
 *   由 app（如 server）启动时通过 `registerProviderCallObserver` 注入。
 * - 全局 hook 列表，所有 DashScopeClient 实例共享 —— 因 DashScopeClient 在 server / worker
 *   多个调用点分散实例化，没有集中初始化点；hook registry 让任意实例都能触发回调。
 * - hook 内部不应抛错（已 try/catch 兜底，但 hook 自身性能影响所有调用）。
 */
export type ProviderCallObserver = (model: string, durationMs: number, success: boolean) => void

const providerCallObservers: ProviderCallObserver[] = []

/**
 * 注册一个 provider 调用观察者。返回反注册函数。
 *
 * 在 app 启动时（如 `apps/server/src/index.ts`）调用一次：
 *
 * ```ts
 * registerProviderCallObserver((model, durationMs, success) => {
 *   recordProviderCall(model, durationMs, success)
 * })
 * ```
 */
export function registerProviderCallObserver(observer: ProviderCallObserver): () => void {
  providerCallObservers.push(observer)
  return () => {
    const idx = providerCallObservers.indexOf(observer)
    if (idx >= 0)
      providerCallObservers.splice(idx, 1)
  }
}

/** 仅供测试用：清空所有 observer。 */
export function __resetProviderCallObservers(): void {
  providerCallObservers.length = 0
}

/**
 * 通知所有已注册的 provider 调用观察者（包内共享）。
 *
 * 由 DashScopeClient（chat/image/video submit）与 ASRClient（paraformer submit）
 * 在每次 provider 调用结束（成功/失败）时调用。observer 抛错不影响主流程。
 * 注：异步任务的轮询查询（queryTask）不计入 —— 与 video `queryTask` 一致，
 * 避免廉价轮询稀释模型真实 latency（见 ASRClient.submitTranscription）。
 */
export function notifyProviderCallObservers(model: string, durationMs: number, success: boolean): void {
  for (const observer of providerCallObservers) {
    try {
      observer(model, durationMs, success)
    }
    catch {
      // hook 抛错不影响主流程；测试环境下也会暴露在 observer 自身日志中。
    }
  }
}

// ── Provider 调用前置 guard（断路器降级）──────────────────────
//
// 与 observer 平行的全局 hook registry：DashScopeClient / ASRClient 在真正发起
// provider 调用前先跑一遍 guard。guard 通过抛 `ModelDegradedError` 阻断调用 ——
// 让处于降级冷却窗口内的模型快速失败，而不是让用户空等几十秒视频提交。
//
// 健康状态查询（读 DB）由 app 注入的 guard 实现负责；@excuse/provider 不依赖 DB。

/**
 * 模型降级错误 —— guard 在模型处于降级冷却窗口内时抛出。
 *
 * `code = 'MODEL_DEGRADED'` 供 @excuse/task-engine 分类为可重试的 provider_error
 * （让在途任务在冷却过期后有机会恢复，而非永久失败）。
 */
export class ModelDegradedError extends Error {
  readonly code = 'MODEL_DEGRADED' as const
  readonly model: string
  readonly retryAfterMs: number
  constructor(model: string, retryAfterMs: number) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
    super(`模型 ${model} 暂时不可用（连续失败已降级），请在约 ${seconds} 秒后重试`)
    this.name = 'ModelDegradedError'
    this.model = model
    this.retryAfterMs = retryAfterMs
  }
}

export type ProviderCallGuard = (model: string) => void

const providerCallGuards: ProviderCallGuard[] = []

/**
 * 注册一个 provider 调用前置 guard。返回反注册函数。
 *
 * guard 通过抛错（通常是 `ModelDegradedError`）阻断调用；不抛则放行。
 * 在 app 启动时（server / worker）调用一次，注入「读 DB 判定模型是否降级」的实现。
 */
export function registerProviderCallGuard(guard: ProviderCallGuard): () => void {
  providerCallGuards.push(guard)
  return () => {
    const idx = providerCallGuards.indexOf(guard)
    if (idx >= 0)
      providerCallGuards.splice(idx, 1)
  }
}

/** 仅供测试用：清空所有 guard。 */
export function __resetProviderCallGuards(): void {
  providerCallGuards.length = 0
}

/**
 * 跑所有前置 guard —— 任一 guard 抛错即阻断本次 provider 调用（错误向上传播）。
 *
 * 由 DashScopeClient / ASRClient 在发起真实调用前调用。无 guard 注册时为 no-op，
 * 行为与未接入降级策略时完全一致（测试 / 旧调用路径不受影响）。
 */
export function runProviderCallGuards(model: string): void {
  for (const guard of providerCallGuards) {
    guard(model)
  }
}

export class DashScopeClient {
  private config: DashScopeConfig

  constructor(config: DashScopeConfig) {
    this.config = config
  }

  private get baseUrl(): string {
    return this.config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1'
  }

  private get headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  private failed(model: string | undefined, error: string): FailedProviderResult {
    return { type: 'failed', success: false, model, error }
  }

  // ── 声明式请求体构建 ──────────────────────────────────
  //
  // 根据 model-configs 中的 requestType + inputMapping 自动组装请求体，
  // 无需任何 model-name 分支判断。新增模型只需编辑 model-configs.ts。

  /**
   * 根据 inputMapping 遍历 params，把每个参数放入正确的请求体位置。
   * 返回 { input, parameters, media } 三个中间收集器。
   */
  private applyMappings(
    params: ValidatedModelParameters,
    inputMapping: Record<string, InputMapping>,
  ): {
    input: Record<string, unknown>
    parameters: Record<string, unknown>
    media: Array<{ type: string, url: string }>
  } {
    const input: Record<string, unknown> = {}
    const parameters: Record<string, unknown> = {}
    const media: Array<{ type: string, url: string }> = []

    for (const [paramName, mapping] of Object.entries(inputMapping)) {
      const value = params[paramName]
      // 跳过未提供、null 的参数
      if (value === undefined || value === null)
        continue
      // 跳过空字符串
      if (typeof value === 'string' && value.trim() === '')
        continue
      // 保留 false / 0 等有意义的 falsy 值

      switch (mapping.target) {
        case 'prompt':
          input.prompt = value
          break
        case 'parameter':
          parameters[paramName] = value
          break
        case 'mediaField':
          input[mapping.field] = value
          break
        case 'media':
          media.push({ type: mapping.mediaType, url: value as string })
          break
        case 'ignored':
          break
      }
    }

    return { input, parameters, media }
  }

  /**
   * 根据 requestType 组装最终请求体
   */
  private buildRequestBody(
    modelConfig: ModelConfig,
    params: ValidatedModelParameters,
    referenceUrls?: string[],
  ): Record<string, unknown> {
    const { requestType, inputMapping } = modelConfig
    if (!inputMapping || !requestType) {
      throw new Error(`模型 ${modelConfig.id} 缺少 requestType 或 inputMapping 配置`)
    }

    const { input, parameters, media } = this.applyMappings(params, inputMapping)

    // referenceUrls → input.media[]（仅 r2v 等声明了 referenceMediaType 的模型）
    if (referenceUrls?.length && modelConfig.referenceMediaType) {
      for (const url of referenceUrls) {
        media.push({ type: modelConfig.referenceMediaType, url })
      }
    }

    switch (requestType) {
      case 'chat': {
        // 文本模型：input.messages[{ role: "user", content: prompt }]
        return {
          model: modelConfig.id,
          input: {
            messages: [{ role: 'user', content: input.prompt || '' }],
          },
          parameters: {
            ...parameters,
            result_format: 'message',
          },
        }
      }

      case 'image': {
        // 图像模型：input.messages[{ role: "user", content: [{ text: prompt }] }]
        return {
          model: modelConfig.id,
          input: {
            messages: [{
              role: 'user',
              content: [{ text: input.prompt || '' }],
            }],
          },
          parameters,
        }
      }

      case 'video-t2v': {
        // 文生视频：input.prompt + input.audio_url/negative_prompt + parameters
        if (media.length > 0) {
          input.media = media
        }
        return {
          model: modelConfig.id,
          input,
          parameters,
        }
      }

      case 'openai-chat': {
        // OpenAI 兼容格式：messages + parameters 在顶层
        return {
          model: modelConfig.id,
          messages: [{ role: 'user', content: input.prompt || '' }],
          ...parameters,
        }
      }

      case 'video-media': {
        // 图生/参考生/编辑视频：input.prompt + input.media[] + input.negative_prompt + parameters
        if (media.length > 0) {
          input.media = media
        }
        return {
          model: modelConfig.id,
          input,
          parameters,
        }
      }

      default:
        throw new Error(`未知的 requestType: ${requestType}`)
    }
  }

  // ── 公开 API 方法 ──────────────────────────────────────

  /**
   * 文本生成 — 调用千问系列模型
   */
  async chatCompletion(model: string, params: ValidatedModelParameters): Promise<TextProviderResult | FailedProviderResult> {
    runProviderCallGuards(model)
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return this.failed(model, `未知模型: ${model}`)
    }

    const body = this.buildRequestBody(modelConfig, params)

    const startTime = Date.now()
    try {
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      })

      const data = await response.json() as DashScopeChatResponse | DashScopeOpenaiChatResponse

      if (response.status !== 200) {
        notifyProviderCallObservers(model, Date.now() - startTime, false)
        return this.failed(model, `模型 ${modelConfig.name}（${modelConfig.id}）: ${parseDashScopeError(data)}`)
      }

      const isOpenaiFormat = modelConfig.requestType === 'openai-chat'
      const usage: DashScopeUsage = isOpenaiFormat
        ? (data as DashScopeOpenaiChatResponse).usage ?? {}
        : (data as DashScopeChatResponse).usage ?? {}

      let text: string
      if (isOpenaiFormat) {
        text = (data as DashScopeOpenaiChatResponse).choices?.[0]?.message?.content ?? ''
      }
      else {
        const output = (data as DashScopeChatResponse).output
        const content = output.choices?.[0]?.message?.content
        text = Array.isArray(content)
          ? content[0]?.text ?? ''
          : typeof content === 'string' ? content : ''
        if (!text && output.text)
          text = output.text
      }

      notifyProviderCallObservers(model, Date.now() - startTime, true)
      return {
        type: 'text',
        success: true,
        model,
        output: {
          type: 'text',
          text,
          raw: data,
        },
        usage: {
          inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
          outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
        },
      }
    }
    catch (error) {
      notifyProviderCallObservers(model, Date.now() - startTime, false)
      const msg = error instanceof Error ? error.message : String(error)
      return this.failed(model, `网络错误：无法连接百炼 API（${msg}）`)
    }
  }

  /**
   * 图片生成 — 调用千问图像系列模型（同步）
   */
  async generateImage(model: string, params: ValidatedModelParameters): Promise<ImageProviderResult | FailedProviderResult> {
    runProviderCallGuards(model)
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return this.failed(model, `未知模型: ${model}`)
    }

    const body = this.buildRequestBody(modelConfig, params)

    const startTime = Date.now()
    try {
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      })

      const data = await response.json() as DashScopeImageResponse

      if (response.status !== 200) {
        notifyProviderCallObservers(model, Date.now() - startTime, false)
        return this.failed(model, `模型 ${modelConfig.name}（${modelConfig.id}）: ${parseDashScopeError(data)}`)
      }

      const output = data.output ?? {}
      const usage: DashScopeUsage = data.usage ?? {}

      // 百炼同步图像 API 返回格式：output.choices[].message.content[].image
      const choices = output.choices ?? []
      const urls = choices.flatMap(c =>
        (c.message?.content ?? [])
          .map(item => item.image)
          .filter((url): url is string => typeof url === 'string' && url.length > 0),
      )

      notifyProviderCallObservers(model, Date.now() - startTime, true)
      return {
        type: 'image',
        success: true,
        model,
        output: {
          type: 'image',
          urls,
          raw: data,
        },
        usage: {
          imageCount: usage.image_count || urls.length,
        },
      }
    }
    catch (error) {
      notifyProviderCallObservers(model, Date.now() - startTime, false)
      const msg = error instanceof Error ? error.message : String(error)
      return this.failed(model, `网络错误：无法连接百炼 API（${msg}）`)
    }
  }

  /**
   * 视频生成 — 异步提交任务
   * 返回 DashScope task_id，需要后续轮询
   */
  async submitVideoTask(model: string, params: ValidatedModelParameters, referenceUrls?: string[]): Promise<VideoTaskProviderResult | FailedProviderResult> {
    runProviderCallGuards(model)
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return this.failed(model, `未知模型: ${model}`)
    }

    const body = this.buildRequestBody(modelConfig, params, referenceUrls)
    const duration = typeof params.duration === 'number' ? params.duration : 0

    const startTime = Date.now()
    try {
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: {
          ...this.headers,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json() as DashScopeVideoSubmitResponse

      if (response.status !== 200) {
        notifyProviderCallObservers(model, Date.now() - startTime, false)
        return this.failed(model, `模型 ${modelConfig.name}（${modelConfig.id}）: ${parseDashScopeError(data)}`)
      }

      const taskId = data.output?.task_id ?? data.request_id
      if (!taskId) {
        notifyProviderCallObservers(model, Date.now() - startTime, false)
        return this.failed(model, `模型 ${modelConfig.name}（${modelConfig.id}）: 未返回 task_id`)
      }

      notifyProviderCallObservers(model, Date.now() - startTime, true)
      return {
        type: 'video_task',
        success: true,
        model,
        taskId,
        output: {
          type: 'processing',
          taskId,
          status: 'submitted',
          raw: data,
        },
        usage: {
          videoDuration: duration,
        },
      }
    }
    catch (error) {
      notifyProviderCallObservers(model, Date.now() - startTime, false)
      const msg = error instanceof Error ? error.message : String(error)
      return this.failed(model, `网络错误：无法连接百炼 API（${msg}）`)
    }
  }

  /**
   * 文本生成（流式） — 支持 requestType: 'openai-chat' 和 'chat' 两类文本模型
   *
   * - openai-chat：调用 compatible-mode/v1/chat/completions，body 顶层 `stream=true`，
   *   按 OpenAI 兼容 SSE 格式解析（choices[0].delta.content + finish_reason）。
   * - chat：调用 DashScope 原生文本生成端点，header 加 `X-DashScope-SSE: enable`，
   *   body `parameters.incremental_output=true`，按 DashScope 原生 SSE 格式解析
   *   （output.text + finish_reason 字符串 + usage.total_tokens）。
   *
   * 两协议都 yield 统一的 TextStreamChunk，调用方（route）无需感知协议差异。
   *
   * @throws Error 当模型不存在或 requestType 不是 'openai-chat' / 'chat'
   */
  async* chatCompletionStream(
    model: string,
    params: ValidatedModelParameters,
  ): AsyncGenerator<TextStreamChunk> {
    runProviderCallGuards(model)
    const modelConfig = getModelById(model)
    if (!modelConfig)
      throw new Error(`未知模型: ${model}`)

    const isChat = modelConfig.requestType === 'chat'
    const isOpenaiChat = modelConfig.requestType === 'openai-chat'
    if (!isChat && !isOpenaiChat)
      throw new Error(`模型 ${model} 不支持流式（仅文本生成模型支持）`)

    const body = this.buildRequestBody(modelConfig, params) as Record<string, unknown>

    if (isOpenaiChat) {
      body.stream = true
    }
    else if (isChat) {
      // DashScope chat 协议：incremental_output 在 parameters 嵌套层
      const parameters = (body.parameters ?? {}) as Record<string, unknown>
      parameters.incremental_output = true
      body.parameters = parameters
    }

    const headers: Record<string, string> = {
      ...this.headers,
      Accept: 'text/event-stream',
    }
    if (isChat)
      headers['X-DashScope-SSE'] = 'enable'

    const response = await fetch(modelConfig.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      throw new Error(`DashScope stream 启动失败 (${response.status}): ${text}`)
    }

    if (isOpenaiChat)
      yield* this.parseOpenAIChatSSE(response.body, model)
    else
      yield* this.parseDashScopeChatSSE(response.body, model)
  }

  /**
   * OpenAI 兼容协议 SSE parser — 解析 `choices[0].delta.content` + `finish_reason`。
   *
   * SSE 按 `\n\n` 分块；每块形如 `data: {...}\n\n`；结束标记 `data: [DONE]`。
   * 单行 JSON.parse 失败时跳过该行，不终止流。
   */
  private async* parseOpenAIChatSSE(
    body: ReadableStream<Uint8Array>,
    model: string,
  ): AsyncGenerator<TextStreamChunk> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done)
          break
        buffer += decoder.decode(value, { stream: true })

        let sep = buffer.indexOf('\n\n')
        while (sep >= 0) {
          const rawEvent = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)

          for (const line of rawEvent.split('\n')) {
            if (!line.startsWith('data:'))
              continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') {
              yield { type: 'text-stream', model, delta: '', done: true }
              return
            }
            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string }, finish_reason?: string | null }>
                usage?: { prompt_tokens?: number, completion_tokens?: number }
              }
              const choice = parsed.choices?.[0]
              const delta = choice?.delta?.content ?? ''
              const finishReason = choice?.finish_reason ?? null
              const parsedUsage = parsed.usage
                ? {
                    inputTokens: parsed.usage.prompt_tokens ?? 0,
                    outputTokens: parsed.usage.completion_tokens ?? 0,
                  }
                : undefined
              yield {
                type: 'text-stream',
                model,
                delta,
                usage: parsedUsage,
                done: finishReason !== null,
              }
            }
            catch {
              // 单行解析失败时跳过，不终止流
            }
          }
          sep = buffer.indexOf('\n\n')
        }
      }
    }
    finally {
      reader.releaseLock()
    }
  }

  /**
   * DashScope chat 协议 SSE parser — 解析 `output.text` + `output.finish_reason`（字符串）。
   *
   * 与 OpenAI 兼容协议的差异：
   *   - delta 在 `output.text`，而不是 `choices[0].delta.content`。
   *   - `finish_reason` 是字符串 `"null"` / `"stop"` / `"length"`，DashScope 用字符串 null 而非 JSON null。
   *   - usage 字段名是 `input_tokens` / `output_tokens`（DashScope 命名），无 `prompt_tokens` 别名。
   *
   * 流结束：`finish_reason === 'stop' | 'length'`，或收到 `data: [DONE]`。
   */
  private async* parseDashScopeChatSSE(
    body: ReadableStream<Uint8Array>,
    model: string,
  ): AsyncGenerator<TextStreamChunk> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done)
          break
        buffer += decoder.decode(value, { stream: true })

        let sep = buffer.indexOf('\n\n')
        while (sep >= 0) {
          const rawEvent = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)

          for (const line of rawEvent.split('\n')) {
            if (!line.startsWith('data:'))
              continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') {
              yield { type: 'text-stream', model, delta: '', done: true }
              return
            }
            try {
              const parsed = JSON.parse(data) as DashScopeChatStreamEvent
              const delta = parsed.output?.text ?? ''
              const finishReason = parsed.output?.finish_reason
              const isDone = finishReason === 'stop' || finishReason === 'length'
              const parsedUsage = parsed.usage
                && (parsed.usage.input_tokens !== undefined || parsed.usage.output_tokens !== undefined)
                ? {
                    inputTokens: parsed.usage.input_tokens ?? 0,
                    outputTokens: parsed.usage.output_tokens ?? 0,
                  }
                : undefined

              yield {
                type: 'text-stream',
                model,
                delta,
                usage: parsedUsage,
                done: isDone,
              }
            }
            catch {
              // 单行解析失败时跳过，不终止流
            }
          }
          sep = buffer.indexOf('\n\n')
        }
      }
    }
    finally {
      reader.releaseLock()
    }
  }

  /**
   * 视频生成 — 异步提交任务 + 自动 fallback
   * 先尝试主模型，失败时自动尝试 modelConfig.fallbackModel
   * 返回最终使用的 model、taskId 和成功状态
   */
  async submitVideoTaskWithFallback(
    model: string,
    params: ValidatedModelParameters,
    referenceUrls?: string[],
  ): Promise<{ model: string, taskId: string | undefined, success: boolean, error?: string }> {
    let result: VideoTaskProviderResult | FailedProviderResult
    try {
      result = await this.submitVideoTask(model, params, referenceUrls)
    }
    catch (error) {
      // 主模型降级（ModelDegradedError）时切 fallback；其它异常向上传播
      if (error instanceof ModelDegradedError) {
        const fallbackId = getModelById(model)?.fallbackModel
        if (fallbackId) {
          const fallbackResult = await this.submitVideoTask(fallbackId, params)
          if (fallbackResult.type === 'video_task') {
            return { model: fallbackId, taskId: fallbackResult.taskId, success: true }
          }
          return { model: fallbackId, taskId: undefined, success: false, error: fallbackResult.error || '视频提交失败' }
        }
      }
      throw error
    }

    if (result.type === 'video_task') {
      return { model, taskId: result.taskId, success: true }
    }

    const modelConfig = getModelById(model)
    const fallbackId = modelConfig?.fallbackModel
    if (fallbackId) {
      const fallbackResult = await this.submitVideoTask(fallbackId, params)
      if (fallbackResult.type === 'video_task') {
        return { model: fallbackId, taskId: fallbackResult.taskId, success: true }
      }
    }

    return { model, taskId: undefined, success: false, error: result.error || '视频提交失败' }
  }

  /**
   * 查询异步任务状态
   */
  async queryTask(taskId: string): Promise<TaskStatus> {
    const url = `${this.baseUrl}/tasks/${taskId}`

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers,
      })

      const data = await response.json() as DashScopeTaskQueryResponse
      const output = data.output ?? {}
      const rawStatus = output.task_status ?? 'UNKNOWN'
      const VALID_TASK_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'] as const
      const taskStatus: TaskStatus['status'] = (VALID_TASK_STATUSES as readonly string[]).includes(rawStatus)
        ? rawStatus as TaskStatus['status']
        : 'UNKNOWN'

      // 任务失败时用友好的中文消息
      const errorCode = output.code ?? data.code
      const errorMessage = taskStatus === 'FAILED'
        ? parseDashScopeError(data)
        : output.message ?? data.message

      return {
        taskId,
        status: taskStatus as TaskStatus['status'],
        // 万相 / HappyHorse 视频任务成功时返回 video_url（无 results）
        // 图片异步任务成功时返回 results 数组
        output: output.video_url || output.results
          ? {
              ...(output.video_url && { video_url: output.video_url }),
              ...(output.results && { results: output.results }),
              ...(typeof output.video_duration === 'number' && { video_duration: output.video_duration }),
              ...(typeof output.duration === 'number' && { duration: output.duration }),
            } as DashScopeTaskOutput
          : undefined,
        usage: data.usage,
        errorCode,
        errorMessage,
      }
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        taskId,
        status: 'UNKNOWN',
        errorMessage: `网络错误：无法查询任务状态（${msg}）`,
      }
    }
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const url = `${this.baseUrl}/tasks/${taskId}`
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.headers,
      })
      return response.ok
    }
    catch {
      return false
    }
  }

  /**
   * 生成内容 — 根据模型类别自动路由到正确的 API
   */
  async generate(model: string, params: ValidatedModelParameters, referenceUrls?: string[]): Promise<ProviderResult> {
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return this.failed(model, `未知模型: ${model}`)
    }

    switch (modelConfig.category) {
      case 'text':
        return this.chatCompletion(model, params)
      case 'image':
        return this.generateImage(model, params)
      case 'video':
        return this.submitVideoTask(model, params, referenceUrls)
      default:
        return this.failed(model, `不支持的模型类别: ${modelConfig.category}`)
    }
  }
}
