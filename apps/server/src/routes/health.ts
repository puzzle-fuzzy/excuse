import { pgClient } from '@excuse/db'
import { Elysia } from 'elysia'
import { getMetrics } from '../services/metrics'
import { getOnlineUserCount } from '../services/sse-manager'

let startTime = Date.now()

/** 探测数据库连接是否可用 */
async function pingDb(): Promise<boolean> {
  try {
    await pgClient`SELECT 1`
    return true
  }
  catch {
    return false
  }
}

/**
 * 健康检查路由
 *
 * GET /api/health        — 综合状态（DB 挂时仍返回 200，仅 status 降级为 degraded）
 * GET /api/health/ready  — readiness 探针：DB 不可达返回 503，供负载均衡摘除流量
 * GET /api/health/live   — liveness 探针：进程存活即 200，用于区分「进程卡死」与「DB 故障」
 * GET /api/health/metrics — 详细指标（请求数、延迟、错误率）
 */
export function createHealthRoutes() {
  return new Elysia({ prefix: '/api/health' })
    .get('/', async () => {
      const dbOk = await pingDb()

      return {
        status: dbOk ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        db: dbOk ? 'ok' : 'error',
        sseConnections: getOnlineUserCount(),
        version: process.env.npm_package_version ?? '0.1.0',
      }
    }, {
      detail: {
        summary: '健康检查',
        description: '返回服务运行状态、DB 连接、uptime、SSE 连接数和版本号',
        tags: ['健康检查'],
      },
    })
    .get('/ready', async ({ set }) => {
      const dbOk = await pingDb()
      if (!dbOk) {
        set.status = 503
        return { status: 'not ready', db: 'error' }
      }
      return { status: 'ready', db: 'ok' }
    }, {
      detail: {
        summary: 'readiness 探针',
        description: 'DB 不可达时返回 503，供负载均衡 / K8s 在 DB 故障时摘除流量',
        tags: ['健康检查'],
      },
    })
    .get('/live', () => {
      return { status: 'ok' }
    }, {
      detail: {
        summary: 'liveness 探针',
        description: '进程存活即返回 200，用于检测进程是否卡死（不依赖 DB）',
        tags: ['健康检查'],
      },
    })
    .get('/metrics', () => {
      const uptime = Math.floor((Date.now() - startTime) / 1000)
      return getMetrics(getOnlineUserCount(), uptime)
    }, {
      detail: {
        summary: '服务指标',
        description: '返回请求计数、延迟分布（p50/p95/p99）、错误率、SSE 在线用户数',
        tags: ['健康检查'],
      },
    })
}

/** 重置 uptime 计时起点（测试用） */
export function resetHealthStartTime() {
  startTime = Date.now()
}
