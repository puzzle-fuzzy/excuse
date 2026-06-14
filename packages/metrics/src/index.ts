/**
 * 指标快照 —— 某一时刻 `MetricsCollector` 对外暴露的只读视图。
 *
 * 调用方（如 `GET /api/health/metrics`）每次请求取一次快照；
 * 快照里的 `byStatus`/`latency` 等结构都是新建的，可安全序列化或跨进程传递。
 */
export interface MetricsSnapshot {
  requests: {
    /** HTTP 请求总数（全量累计，不受 latencyWindowSize 滑动窗口影响） */
    total: number
    /** 按状态码分桶的计数，键为状态码（如 200、500） */
    byStatus: Record<number, number>
  }
  /** 延迟统计 —— 基于「最近 N 条」滑动窗口计算 */
  latency: {
    p50: number
    p95: number
    p99: number
    avgMs: number
  }
  sse: {
    /** 当前在线用户数（由调用方注入，收集器自身不追踪连接） */
    onlineUsers: number
  }
  generation: {
    /** 生成任务按状态（processing/succeeded/failed/cancelled …）分桶的计数 */
    byStatus: Record<string, number>
  }
  /** 错误总数 = 显式 recordError() 调用 + 状态码 >= 500 的请求次数 */
  errors: number
  /** 进程运行时长（秒），由调用方注入 */
  uptime: number
}

interface MetricsCollectorOptions {
  /** 滑动窗口大小：只保留最近 N 条请求的延迟用于计算 p50/p95/p99/avg，默认 1000 */
  latencyWindowSize?: number
}

/**
 * 进程内、内存态的指标收集器。
 *
 * 设计要点：
 * - 单实例、无并发锁，适合 server 单进程使用；
 * - 不追踪 SSE 连接数和进程启动时间，二者由调用方在取快照时注入；
 * - 延迟用滑动窗口 + 增量求和，保证 avg O(1)，percentile 仅在 snapshot 时排序一次。
 */
export class MetricsCollector {
  private readonly latencyWindowSize: number
  private readonly latencyWindow: number[] = []
  private latencySum = 0
  private totalRequests = 0
  private readonly statusCounts = new Map<number, number>()
  private readonly generationStatusCounts = new Map<string, number>()
  private errorCount = 0

  constructor(options: MetricsCollectorOptions = {}) {
    this.latencyWindowSize = options.latencyWindowSize ?? 1000
  }

  /**
   * 记录一次 HTTP 请求。
   *
   * 会同时：累计 totalRequests、按状态码入桶、把延迟压入滑动窗口
   * （窗口超限时丢弃最旧一条并从 sum 中扣除，保持 avg 准确）。
   * 若状态码 >= 500，还会额外计一次错误（与 recordError() 共用同一计数器）。
   */
  recordRequest(status: number, durationMs: number): void {
    this.totalRequests++

    const current = this.statusCounts.get(status) ?? 0
    this.statusCounts.set(status, current + 1)

    this.latencyWindow.push(durationMs)
    this.latencySum += durationMs
    if (this.latencyWindow.length > this.latencyWindowSize) {
      const removed = this.latencyWindow.shift()!
      this.latencySum -= removed
    }

    if (status >= 500)
      this.errorCount++
  }

  /**
   * 记录一次「非 HTTP 请求」类错误，例如 SSE 断连、DB 操作失败。
   * 仅自增错误计数，不关联状态码或延迟。
   */
  recordError(): void {
    this.errorCount++
  }

  /**
   * 记录一次生成任务状态变更。
   *
   * 仅在调用方所在进程内生效。`MetricsCollector` 是 server 进程内存态单例，
   * 因此 worker 异步任务（如视频轮询）的终态不会聚合到这里 —— 这是有意的架构边界，
   * 而非实现缺陷。
   */
  recordGenerationStatus(status: string): void {
    const current = this.generationStatusCounts.get(status) ?? 0
    this.generationStatusCounts.set(status, current + 1)
  }

  /**
   * 生成当前指标快照。
   *
   * `onlineUsers`（在线用户数）与 `uptime`（运行时长）由调用方注入 ——
   * 收集器自身不持有 SSE 连接表和启动时间戳。
   * 内部会对延迟窗口拷贝后排序来计算分位数，调用频率不宜过高。
   */
  snapshot(onlineUsers: number, uptime: number): MetricsSnapshot {
    const sorted = [...this.latencyWindow].sort((a, b) => a - b)

    const byStatus: Record<number, number> = {}
    for (const [code, count] of this.statusCounts) {
      byStatus[code] = count
    }

    const generationByStatus: Record<string, number> = {}
    for (const [status, count] of this.generationStatusCounts) {
      generationByStatus[status] = count
    }

    return {
      requests: {
        total: this.totalRequests,
        byStatus,
      },
      latency: {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        avgMs: this.latencyWindow.length > 0 ? Math.round(this.latencySum / this.latencyWindow.length) : 0,
      },
      sse: {
        onlineUsers,
      },
      generation: {
        byStatus: generationByStatus,
      },
      errors: this.errorCount,
      uptime,
    }
  }

  /**
   * 重置全部计数与延迟窗口回零。主要用于测试，或在需要清空历史统计时手动调用。
   */
  reset(): void {
    this.totalRequests = 0
    this.statusCounts.clear()
    this.generationStatusCounts.clear()
    this.errorCount = 0
    this.latencyWindow.length = 0
    this.latencySum = 0
  }
}

/**
 * 从已升序排序的数组中按 nearest-rank 法计算第 p 百分位。
 *
 * 公式：idx = ceil(p / 100 * n) - 1，并下界 clamp 到 0；空数组返回 0。
 * 入参必须已排序 —— 函数内不再排序，以便 snapshot 复用同一份排序结果。
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0)
    return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]!
}

export * from './prometheus'
