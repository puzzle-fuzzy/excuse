export interface MetricsSnapshot {
  requests: {
    total: number
    byStatus: Record<number, number>
  }
  latency: {
    p50: number
    p95: number
    p99: number
    avgMs: number
  }
  sse: {
    onlineUsers: number
  }
  generation: {
    byStatus: Record<string, number>
  }
  errors: number
  uptime: number
}

interface MetricsCollectorOptions {
  latencyWindowSize?: number
}

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

  reset(): void {
    this.totalRequests = 0
    this.statusCounts.clear()
    this.generationStatusCounts.clear()
    this.errorCount = 0
    this.latencyWindow.length = 0
    this.latencySum = 0
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0)
    return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]!
}
