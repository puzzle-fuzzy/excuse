/**
 * Fake DashScope provider — E2E 冒烟测试的桩适配器
 *
 * 设计目标（docs/TODO.md §三、1）：E2E 默认不访问真实 DashScope，provider 由测试环境 mock。
 * 本桩实现 `DashScopeClient` 的完整公开方法面，返回确定性结果（文本/图片/视频任务/音频/任务查询），
 * 并记录每次调用，供断言「provider 注入是否生效」——这是本 TODO 依赖的 provider 依赖注入地基的直接验证。
 *
 * 行为约定（刻意克制 mock 复杂度）：
 *   - 文本：返回可配置的固定文本（默认问候语；Canvas analyze 旅程切到 NovelAnalysis JSON）。
 *   - 图片：返回固定 OSS 风格 URL（不真下载；图片下载路径由 storage 单测与 assemble 真实冒烟覆盖）。
 *   - 视频：submit 返回 video_task + 假 taskId；queryTask 返回 SUCCEEDED + 可配置 video_url。
 *   - 音频：返回固定 URL + 时长。
 *   - 不模拟 DashScope 协议边缘情况——保持稳定、可复现。
 *
 * 注入：经 `createServerContext` / `createWorkerContext` 的 overrides 注入。由于 ServerContext.client
 * 类型为具体类 `DashScopeClient`（含私有字段），桩需 `as unknown as DashScopeClient` 单点转换
 * （这是 overrides 为 fake provider 预留的注入口，见 apps/server/src/context.ts）。
 */
import type {
  AudioProviderResult,
  DashScopeClient,
  ImageProviderResult,
  ProviderResult,
  ProviderUsage,
  TaskStatus,
  TextProviderResult,
  TextStreamChunk,
  ValidatedModelParameters,
  VideoTaskProviderResult,
} from '@excuse/provider'
import { getModelById } from '@excuse/provider'

/** 单次 generate / chatCompletion 调用的记录（供断言 provider 是否被调用） */
interface GenerateCall {
  model: string
  params: ValidatedModelParameters
  referenceUrls?: string[]
}

/** 测试面向的控制器：调用记录 + 响应配置 */
export interface FakeProviderControl {
  /** generate / chatCompletion / submitVideoTask 的调用记录 */
  readonly calls: {
    generate: GenerateCall[]
    chatCompletion: GenerateCall[]
    submitVideoTask: GenerateCall[]
    queryTask: string[]
  }
  /** 设置 chatCompletion / 文本类 generate 返回的文本（默认问候语） */
  setChatResponse: (text: string) => void
  /** 设置视频任务成功后返回的 video_url（worker 下载用，由 stack 在 listen 后注入 baseUrl） */
  setVideoResult: (url: string) => void
}

const DEFAULT_CHAT_TEXT = '[fake-provider] 你好，这是 E2E 冒烟测试的确定性回复。'

/**
 * 桩 provider —— 同时实现 DashScopeClient 公开方法面与 FakeProviderControl。
 *
 * `asFakeProvider()` 返回注入用的 client + 控制器，避免在每个调用点重复 cast。
 */
export class FakeDashScopeClient {
  private chatText = DEFAULT_CHAT_TEXT
  private videoUrl = 'http://fake-provider.local/video.mp4'
  private taskIdSeq = 0

  readonly calls = {
    generate: [] as GenerateCall[],
    chatCompletion: [] as GenerateCall[],
    submitVideoTask: [] as GenerateCall[],
    queryTask: [] as string[],
  }

  setChatResponse(text: string): void {
    this.chatText = text
  }

  setVideoResult(url: string): void {
    this.videoUrl = url
  }

  // ── DashScopeClient 方法面 ──────────────────────────

  async generate(model: string, params: ValidatedModelParameters, referenceUrls?: string[]): Promise<ProviderResult> {
    this.calls.generate.push({ model, params, referenceUrls })
    const cfg = getModelById(model)
    switch (cfg?.category) {
      case 'image':
        return this.imageResult(model)
      case 'video':
        return this.videoTaskResult(model)
      case 'audio':
        return this.audioResult(model)
      default:
        return this.textResult(model)
    }
  }

  async chatCompletion(model: string, params: ValidatedModelParameters): Promise<TextProviderResult | { type: 'failed', success: false, model?: string, error: string }> {
    this.calls.chatCompletion.push({ model, params })
    return this.textResult(model)
  }

  async generateImage(model: string, params: ValidatedModelParameters): Promise<ImageProviderResult | { type: 'failed', success: false, model?: string, error: string }> {
    this.calls.generate.push({ model, params })
    return this.imageResult(model)
  }

  async generateAudio(model: string, params: ValidatedModelParameters): Promise<AudioProviderResult | { type: 'failed', success: false, model?: string, error: string }> {
    this.calls.generate.push({ model, params })
    return this.audioResult(model)
  }

  async submitVideoTask(model: string, params: ValidatedModelParameters, referenceUrls?: string[]): Promise<VideoTaskProviderResult | { type: 'failed', success: false, model?: string, error: string }> {
    this.calls.submitVideoTask.push({ model, params, referenceUrls })
    return this.videoTaskResult(model)
  }

  async submitVideoTaskWithFallback(model: string, params: ValidatedModelParameters, referenceUrls?: string[]): Promise<{ model: string, taskId: string, success: boolean, error?: string }> {
    this.calls.submitVideoTask.push({ model, params, referenceUrls })
    const result = this.videoTaskResult(model)
    return { model, taskId: result.taskId, success: true }
  }

  async* chatCompletionStream(model: string, params: ValidatedModelParameters): AsyncGenerator<TextStreamChunk> {
    this.calls.chatCompletion.push({ model, params })
    yield { type: 'text-stream', model, delta: this.chatText, usage: undefined, done: false }
    yield { type: 'text-stream', model, delta: '', usage: { inputTokens: 10, outputTokens: 20 }, done: true }
  }

  async queryTask(taskId: string): Promise<TaskStatus> {
    this.calls.queryTask.push(taskId)
    return {
      taskId,
      status: 'SUCCEEDED',
      output: { video_url: this.videoUrl, video_duration: 5 },
    }
  }

  async cancelTask(_taskId: string): Promise<boolean> {
    return true
  }

  // ── 结果构造器 ──────────────────────────────────────

  private nextTaskId(): string {
    this.taskIdSeq += 1
    // 含时间戳 + 计数器，保证跨进程/跨运行的唯一性——真实 DashScope 的 taskId 同样唯一，
    // 避免在持久化的测试库上重跑时撞 generation_records.task_id 唯一约束。
    return `fake-video-${Date.now()}-${this.taskIdSeq}`
  }

  private textResult(model: string): TextProviderResult {
    // 非零 usage：qwen 类文本模型按「每百万 token」计价，1000 input + 500 output token
    // 在 qwen-max（240/960 每 1M token）下 = 0.24 + 0.48 = 0.72 分（sub-cent）。
    // 计费列已改为 numeric(20,4) + numeric→Number parser（见 packages/db/src/db.ts），
    // 该 sub-cent 金额能完整 reserve→debit 落库——这正是「integer 计费 vs sub-cent 定价」
    // 冲突修复后的直接验证。注册赠送 1000 分覆盖该 debit。
    const usage: ProviderUsage = { inputTokens: 1000, outputTokens: 500 }
    return {
      type: 'text',
      success: true,
      model,
      output: { type: 'text', text: this.chatText, raw: { source: 'fake-provider' } },
      usage,
    }
  }

  private imageResult(model: string): ImageProviderResult {
    return {
      type: 'image',
      success: true,
      model,
      output: { type: 'image', urls: ['http://fake-provider.local/image.png'], raw: { source: 'fake-provider' } },
      usage: { imageCount: 1 },
    }
  }

  private videoTaskResult(model: string): VideoTaskProviderResult {
    const taskId = this.nextTaskId()
    return {
      type: 'video_task',
      success: true,
      model,
      taskId,
      output: { type: 'processing', taskId, status: 'submitted', raw: { source: 'fake-provider' } },
      usage: { videoDuration: 5 },
    }
  }

  private audioResult(model: string): AudioProviderResult {
    return {
      type: 'audio',
      success: true,
      model,
      output: {
        type: 'audio',
        url: 'http://fake-provider.local/bgm.mp3',
        durationSeconds: 10,
        format: 'mp3',
        raw: { source: 'fake-provider' },
      },
      usage: { audioDuration: 10 },
    }
  }
}

/**
 * 构造一个 fake provider 实例 + 控制器
 *
 * @returns `client` 经单点 cast 为 DashScopeClient（注入用），`control` 暴露调用记录与响应配置。
 */
export function createFakeProvider(): { client: DashScopeClient, control: FakeProviderControl } {
  const instance = new FakeDashScopeClient()
  return {
    client: instance as unknown as DashScopeClient,
    control: instance,
  }
}
