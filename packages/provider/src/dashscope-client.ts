import type {
  DashScopeChatResponse,
  DashScopeImageResponse,
  DashScopeOpenaiChatResponse,
  DashScopeTaskQueryResponse,
  DashScopeUsage,
  DashScopeVideoSubmitResponse,
  FunMusicResponse,
} from './dashscope-types'
import type { ValidatedModelParameters } from './model-validator'
import type {
  AudioProviderResult,
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
import { buildRequestBody } from './dashscope-request-builder'
import { parseDashScopeChatSSE, parseOpenAIChatSSE } from './dashscope-sse'
import {
  createStreamTimeoutController,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  isAbortError,
  timeoutSignal,
} from './http-timeout'
import { getModelById } from './model-configs'
import { ModelDegradedError, notifyProviderCallObservers, runProviderCallGuards } from './provider-hooks'

// 重导出 —— 保持下游 import 路径不变
export {
  __resetProviderCallGuards,
  __resetProviderCallObservers,
  ModelDegradedError,
  notifyProviderCallObservers,
  registerProviderCallGuard,
  registerProviderCallObserver,
  runProviderCallGuards,
} from './provider-hooks'
export type { ProviderCallGuard, ProviderCallObserver } from './provider-hooks'

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

  /** 同步调用整体超时（ms），未配置时回落默认 60s。 */
  private get httpTimeoutMs(): number {
    return this.config.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS
  }

  /** 流式调用空闲超时（ms），未配置时回落默认 30s。 */
  private get streamIdleTimeoutMs(): number {
    return this.config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  }

  private failed(model: string | undefined, error: string, code?: string): FailedProviderResult {
    return { type: 'failed', success: false, model, error, ...(code && { code }) }
  }

  private transportErrorCode(error: unknown): string {
    return isAbortError(error) ? 'TIMEOUT' : 'ECONNRESET'
  }

  private transportFailure(model: string | undefined, error: unknown, prefix: string): FailedProviderResult {
    const code = this.transportErrorCode(error)
    const msg = error instanceof Error ? error.message : String(error)
    const detail = code === 'TIMEOUT' ? '请求超时' : `网络错误：${prefix}（${msg}）`
    return this.failed(model, detail, code)
  }

  /** 同步调用 — observer + 传输层错误 try/catch 模板 */
  private async withErrorHandling<T>(
    model: string,
    fn: (startTime: number) => Promise<T>,
  ): Promise<T | FailedProviderResult> {
    const startTime = Date.now()
    try {
      return await fn(startTime)
    }
    catch (error: unknown) {
      notifyProviderCallObservers(model, Date.now() - startTime, false)
      return this.transportFailure(model, error, '无法连接百炼 API')
    }
  }

  // ── 公开 API 方法 ──────────────────────────────────────

  /**
   * 文本生成 — 调用千问系列模型
   */
  async chatCompletion(model: string, params: ValidatedModelParameters): Promise<TextProviderResult | FailedProviderResult> {
    return this.withErrorHandling(model, async () => {
      runProviderCallGuards(model)
      const modelConfig = getModelById(model)
      if (!modelConfig)
        return this.failed(model, `未知模型: ${model}`)

      const body = buildRequestBody(modelConfig, params)
      const startTime = Date.now()
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: timeoutSignal(this.httpTimeoutMs),
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
        output: { type: 'text', text, raw: data },
        usage: {
          inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
          outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
        },
      }
    })
  }

  /**
   * 图片生成 — 调用千问图像系列模型（同步）
   */
  async generateImage(model: string, params: ValidatedModelParameters): Promise<ImageProviderResult | FailedProviderResult> {
    return this.withErrorHandling(model, async () => {
      runProviderCallGuards(model)
      const modelConfig = getModelById(model)
      if (!modelConfig)
        return this.failed(model, `未知模型: ${model}`)

      const body = buildRequestBody(modelConfig, params)
      const startTime = Date.now()
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: timeoutSignal(this.httpTimeoutMs),
      })

      const data = await response.json() as DashScopeImageResponse

      if (response.status !== 200) {
        notifyProviderCallObservers(model, Date.now() - startTime, false)
        return this.failed(model, `模型 ${modelConfig.name}（${modelConfig.id}）: ${parseDashScopeError(data)}`)
      }

      const output = data.output ?? {}
      const usage: DashScopeUsage = data.usage ?? {}
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
        output: { type: 'image', urls, raw: data },
        usage: { imageCount: usage.image_count || urls.length },
      }
    })
  }

  /**
   * 音频生成 — 调用 fun-music-v1（FunMusic）生成 BGM（同步）
   */
  async generateAudio(model: string, params: ValidatedModelParameters): Promise<AudioProviderResult | FailedProviderResult> {
    return this.withErrorHandling(model, async () => {
      runProviderCallGuards(model)
      const modelConfig = getModelById(model)
      if (!modelConfig)
        return this.failed(model, `未知模型: ${model}`)

      const body = buildRequestBody(modelConfig, params)
      const startTime = Date.now()
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: timeoutSignal(this.httpTimeoutMs),
      })

      const data = await response.json() as FunMusicResponse

      if (response.status !== 200) {
        notifyProviderCallObservers(model, Date.now() - startTime, false)
        return this.failed(model, `模型 ${modelConfig.name}（${modelConfig.id}）: ${parseDashScopeError(data)}`)
      }

      const audio = data.output?.audio
      const url = audio?.url
      if (!url) {
        notifyProviderCallObservers(model, Date.now() - startTime, false)
        return this.failed(model, `模型 ${modelConfig.name}（${modelConfig.id}）: 未返回 audio.url`)
      }

      const durationSeconds = typeof data.usage?.duration === 'number' ? data.usage.duration : 0

      notifyProviderCallObservers(model, Date.now() - startTime, true)
      return {
        type: 'audio',
        success: true,
        model,
        output: {
          type: 'audio',
          url,
          durationSeconds,
          format: typeof params.format === 'string' ? params.format : 'mp3',
          raw: data,
        },
        usage: { audioDuration: durationSeconds },
      }
    })
  }

  /**
   * 视频生成 — 异步提交任务
   */
  async submitVideoTask(model: string, params: ValidatedModelParameters, referenceUrls?: string[]): Promise<VideoTaskProviderResult | FailedProviderResult> {
    return this.withErrorHandling(model, async () => {
      runProviderCallGuards(model)
      const modelConfig = getModelById(model)
      if (!modelConfig)
        return this.failed(model, `未知模型: ${model}`)

      const body = buildRequestBody(modelConfig, params, referenceUrls)
      const duration = typeof params.duration === 'number' ? params.duration : 0
      const startTime = Date.now()
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: { ...this.headers, 'X-DashScope-Async': 'enable' },
        body: JSON.stringify(body),
        signal: timeoutSignal(this.httpTimeoutMs),
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
        output: { type: 'processing', taskId, status: 'submitted', raw: data },
        usage: { videoDuration: duration },
      }
    })
  }

  /**
   * 文本生成（流式） — 支持 requestType: 'openai-chat' 和 'chat' 两类文本模型
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

    const body = buildRequestBody(modelConfig, params) as Record<string, unknown>

    if (isOpenaiChat) {
      body.stream = true
    }
    else if (isChat) {
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

    const streamTimeout = createStreamTimeoutController(this.streamIdleTimeoutMs)

    let response: Response
    try {
      response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: streamTimeout.signal,
      })
    }
    catch (error) {
      streamTimeout.clear()
      throw error
    }

    if (!response.ok || !response.body) {
      streamTimeout.clear()
      const text = await response.text().catch(() => '')
      throw new Error(`DashScope stream 启动失败 (${response.status}): ${text}`)
    }

    try {
      if (isOpenaiChat)
        yield* parseOpenAIChatSSE(response.body, model, streamTimeout)
      else
        yield* parseDashScopeChatSSE(response.body, model, streamTimeout)
    }
    finally {
      streamTimeout.clear()
    }
  }

  /**
   * 视频生成 — 异步提交任务 + 自动 fallback
   */
  async submitVideoTaskWithFallback(
    model: string,
    params: ValidatedModelParameters,
    referenceUrls?: string[],
  ): Promise<{ model: string, taskId: string | undefined, success: boolean, error?: string, code?: string }> {
    let result: VideoTaskProviderResult | FailedProviderResult
    try {
      result = await this.submitVideoTask(model, params, referenceUrls)
    }
    catch (error) {
      if (error instanceof ModelDegradedError) {
        const fallbackId = getModelById(model)?.fallbackModel
        if (fallbackId) {
          const fallbackResult = await this.submitVideoTask(fallbackId, params)
          if (fallbackResult.type === 'video_task') {
            return { model: fallbackId, taskId: fallbackResult.taskId, success: true }
          }
          return { model: fallbackId, taskId: undefined, success: false, error: fallbackResult.error || '视频提交失败', code: fallbackResult.code }
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
      return { model: fallbackId, taskId: undefined, success: false, error: fallbackResult.error || '视频提交失败', code: fallbackResult.code }
    }

    return { model, taskId: undefined, success: false, error: result.error || '视频提交失败', code: result.code }
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
        signal: timeoutSignal(this.httpTimeoutMs),
      })

      const data = await response.json() as DashScopeTaskQueryResponse
      const output = data.output ?? {}
      const rawStatus = output.task_status ?? 'UNKNOWN'
      const VALID_TASK_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'] as const
      const taskStatus: TaskStatus['status'] = (VALID_TASK_STATUSES as readonly string[]).includes(rawStatus)
        ? rawStatus as TaskStatus['status']
        : 'UNKNOWN'

      const errorCode = output.code ?? data.code
      const errorMessage = taskStatus === 'FAILED'
        ? parseDashScopeError(data)
        : output.message ?? data.message

      return {
        taskId,
        status: taskStatus as TaskStatus['status'],
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
      const code = this.transportErrorCode(error)
      const msg = error instanceof Error ? error.message : String(error)
      const detail = code === 'TIMEOUT'
        ? '查询任务状态超时'
        : `网络错误：无法查询任务状态（${msg}）`
      return {
        taskId,
        status: 'UNKNOWN',
        errorCode: code,
        errorMessage: detail,
      }
    }
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const url = `${this.baseUrl}/tasks/${taskId}`
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.headers,
        signal: timeoutSignal(this.httpTimeoutMs),
      })
      return response.ok
    }
    catch {
      return false
    }
  }

  /**
   * Category → generate 方法映射表（替代 switch）。
   * 新增 category 时在此登记一行即可，无需改动 generate() 逻辑。
   */
  private readonly CATEGORY_GENERATORS: Record<string, (model: string, params: ValidatedModelParameters, referenceUrls?: string[]) => Promise<ProviderResult>> = {
    text: (m, p) => this.chatCompletion(m, p),
    image: (m, p) => this.generateImage(m, p),
    video: (m, p, refs) => this.submitVideoTask(m, p, refs),
    audio: (m, p) => this.generateAudio(m, p),
  }

  /**
   * 生成内容 — 根据模型 category 自动路由到正确的 API
   */
  async generate(model: string, params: ValidatedModelParameters, referenceUrls?: string[]): Promise<ProviderResult> {
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return this.failed(model, `未知模型: ${model}`)
    }

    const handler = this.CATEGORY_GENERATORS[modelConfig.category]
    if (!handler) {
      return this.failed(model, `不支持的模型类别: ${modelConfig.category}`)
    }
    return handler(model, params, referenceUrls)
  }
}
