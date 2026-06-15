import type { ProviderCallStats } from '@excuse/metrics'
import { createLogger } from '@excuse/shared'

const logger = createLogger('worker-metrics')

/** worker `/provider-calls` 返回的 JSON 结构 */
interface WorkerProviderCallsResponse {
  workerId?: string
  providerCalls?: Record<string, ProviderCallStats>
}

/** worker 响应不允许传回过大的 durations 数组 —— 单 model 上限（防御性） */
const MAX_DURATIONS_PER_MODEL = 2000

/** fetch 超时（worker 在同机 loopback，应很快） */
const FETCH_TIMEOUT_MS = 2000

/**
 * 转运 worker `/provider-calls` JSON 快照为 `Record<string, ProviderCallStats>`。
 *
 * - `url` 未配置（undefined / 空）→ 直接返回空 map（worker 聚合关闭，admin 仅反映 server 进程）。
 * - 带可选 token 时发送 `Authorization: Bearer <token>`（与 worker `evaluateMetricsAccess` 共用）。
 * - 任何错误（网络、超时、非 2xx、解析失败）→ 记 debug 日志并返回空 map，
 *   绝不让 admin 接口因 worker 不可达而整体失败（best-effort）。
 *
 * 返回的 durations 做轻量裁剪与校验，防止异常 worker 响应污染 server 内存。
 */
export async function fetchWorkerProviderCalls(
  url: string | undefined,
  token: string | undefined,
): Promise<Record<string, ProviderCallStats>> {
  if (!url)
    return {}

  const endpoint = `${url.replace(/\/$/, '')}/provider-calls`
  const headers: Record<string, string> = {}
  if (token)
    headers.authorization = `Bearer ${token}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(endpoint, { signal: controller.signal, headers })
    if (!response.ok) {
      logger.debug({ endpoint, status: response.status }, 'worker /provider-calls non-2xx, skipping merge')
      return {}
    }
    const payload = await response.json() as WorkerProviderCallsResponse
    return sanitizeProviderCalls(payload?.providerCalls)
  }
  catch (error) {
    logger.debug({ endpoint, err: error instanceof Error ? error.message : String(error) }, 'worker /provider-calls fetch failed, skipping merge')
    return {}
  }
  finally {
    clearTimeout(timeout)
  }
}

/** 校验并裁剪 worker 返回的 providerCalls，防止异常结构污染合并结果 */
function sanitizeProviderCalls(
  raw: Record<string, ProviderCallStats> | undefined,
): Record<string, ProviderCallStats> {
  if (!raw || typeof raw !== 'object')
    return {}

  const sanitized: Record<string, ProviderCallStats> = {}
  for (const [model, stats] of Object.entries(raw)) {
    if (!stats || typeof stats !== 'object')
      continue
    const success = Number.isFinite(stats.success) ? stats.success : 0
    const failed = Number.isFinite(stats.failed) ? stats.failed : 0
    const durations = Array.isArray(stats.durations)
      ? stats.durations.filter((d): d is number => Number.isFinite(d)).slice(0, MAX_DURATIONS_PER_MODEL)
      : []
    sanitized[model] = { success, failed, durations }
  }
  return sanitized
}
