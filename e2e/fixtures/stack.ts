import type { ServerConfig } from '../../apps/server/src/config'
import type { WorkerConfig } from '../../apps/worker/src/config'
/**
 * E2E 全栈启动夹具 — 真实 server（注入 fake provider）+ 真实 Postgres + 真实 SSE 桥接
 *
 * 编排（docs/TODO.md §三、1）：
 *   1. 临时本地存储目录（不碰 OSS、不碰开发库）
 *   2. 构造 ServerConfig / WorkerConfig（端口 0 = 随机空闲端口）
 *   3. createFakeProvider() → 经 createServerContext / createWorkerContext 的 overrides 注入
 *   4. createElysiaApp(config, ctx) 装配真实应用 → listen(0) → 拿到 baseUrl
 *   5. startSSEListener() — 真实 PG LISTEN（worker 的 NOTIFY 经同一 DB 推到 server → SSE）
 *   6. 暴露 processVideoRecord()：驱动 worker 的 createTaskProcessor（fake queryTask + stub download），
 *      用以在不触达真实 DashScope / 不引入下载 flaky 的前提下验证 worker 侧 provider 注入。
 *
 * 全部旅程默认不访问真实 DashScope：provider 调用全部命中 fake。
 */
import type { FakeProviderControl } from './fake-provider'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getGenerationRecordById, pgClient, waitForDb } from '@excuse/db'
import { createElysiaApp } from '../../apps/server/src/app'
import { createServerContext } from '../../apps/server/src/context'
import { startSSEListener } from '../../apps/server/src/services/sse-manager'
import { createWorkerContext } from '../../apps/worker/src/context'
import { createTaskProcessor } from '../../apps/worker/src/task-processor'
import { createFakeProvider } from './fake-provider'

export interface TestStack {
  /** 已监听 server 的基础 URL（含随机端口），如 `http://127.0.0.1:50913` */
  baseUrl: string
  /** fake provider 控制器（调用记录 + 响应配置） */
  control: FakeProviderControl
  /** 临时存储根目录（测试结束清理） */
  storageRoot: string
  /** 对 baseUrl 发起 fetch 的便捷方法 */
  api: (path: string, init?: RequestInit) => Promise<Response>
  /**
   * 驱动 worker 视频处理器处理一条 processing 状态的生成记录。
   *
   * 真实走 createTaskProcessor（queryTask 经 workerCtx.client = fake；DB 写真实），
   * 仅 downloadAndMap 桩化（下载路径由 storage 单测与 assemble 真实冒烟覆盖，避免 E2E flaky）。
   */
  processVideoRecord: (recordId: string) => Promise<void>
  /** 停止 server + 关闭 PG 连接 + 清理临时目录 */
  stop: () => Promise<void>
}

/** 唯一运行标识，避免用户名/邮箱在重复运行或共享 DB 上撞唯一约束 */
const RUN_ID = `${process.pid}-${Date.now()}`

/**
 * 启动 E2E 全栈。前置：DATABASE_URL 指向已 db:push 的库（CI 自动；本地见 e2e/README.md）。
 */
export async function startTestStack(): Promise<TestStack> {
  // 1. 临时存储目录
  const storageRoot = join(tmpdir(), `excuse-e2e-${RUN_ID}`)
  mkdirSync(storageRoot, { recursive: true })

  // 2. 配置（端口 0 = 系统分配空闲端口；DATABASE_URL 取环境，缺省回落开发库）
  const databaseUrl = process.env.DATABASE_URL || 'postgres://excuse:excuse_dev@localhost:5433/excuse'
  const serverConfig: ServerConfig = {
    port: 0,
    databaseUrl,
    dashscopeApiKey: 'fake-e2e-key',
    dashscopeBaseUrl: 'http://fake-provider.local',
    storageRoot,
    frontendUrl: 'http://localhost:8007',
    workerPollIntervalMs: 1000,
    jwtSecret: process.env.JWT_SECRET || 'e2e-test-jwt-secret-not-for-production-use',
    jwtExpiresIn: '1h',
    oss: undefined,
    metricsAllowedCidrs: ['127.0.0.1/32', '::1/128'],
    adminUserIds: [],
    processStartTime: Date.now(),
  }
  const workerConfig: WorkerConfig = {
    dashscopeApiKey: 'fake-e2e-key',
    dashscopeBaseUrl: 'http://fake-provider.local',
    storageRoot,
    pollIntervalMs: 1000,
    staleTimeoutMs: 4 * 60 * 60 * 1000,
    claimTtlMs: 30_000,
    sweepIntervalMs: 60_000,
    oss: undefined,
    metricsAccessToken: undefined,
    metricsAllowedCidrs: ['127.0.0.1/32', '::1/128'],
  }

  // 3. fake provider 注入（client 注入；storage 由 context 按 storageRoot 默认构造本地存储）
  const { client: fakeClient, control } = createFakeProvider()
  const serverCtx = createServerContext(serverConfig, { client: fakeClient })
  const workerCtx = createWorkerContext(workerConfig, { client: fakeClient })

  // 4. 装配 + 监听随机端口
  const app = createElysiaApp(serverConfig, serverCtx)
  await new Promise<void>((resolve) => {
    app.listen(0, () => resolve())
  })
  const port = app.server?.port
  if (!port)
    throw new Error('E2E server failed to bind a port')
  const baseUrl = `http://127.0.0.1:${port}`

  // 5. DB 就绪 + SSE LISTEN（真实 PG）
  await waitForDb(10, 500)
  // SSE 监听失败不阻断冒烟（SSE 非旅程核心断言路径）；记录但不抛。
  await startSSEListener().catch(() => {})

  const api = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init)

  // 6. worker 视频处理器（fake queryTask + 桩 downloadAndMap）
  const processor = createTaskProcessor(workerCtx, {
    // 桩：直接回填本地公开 URL（不真下载），保证稳定可复现。
    // 真实下载路径由 storage 单测与 assemble 真实冒烟覆盖，E2E 不重复其 flaky 风险。
    downloadAndMap: async (urls: string[]) => urls.map((_url, i) => `/api/uploads/e2e/stub-${i}.mp4`),
  })

  const processVideoRecord = async (recordId: string) => {
    const record = await getGenerationRecordById(recordId)
    if (!record)
      throw new Error(`E2E: generation record ${recordId} not found`)
    await processor.processTask(record)
  }

  const stop = async () => {
    app.stop()
    await pgClient.end().catch(() => {})
    rmSync(storageRoot, { recursive: true, force: true })
  }

  return { baseUrl, control, storageRoot, api, processVideoRecord, stop }
}

// ── 旅程辅助：注册唯一用户，返回 Bearer token（auth 第 3 通道接受裸 JWT） ────────

let userSeq = 0

export interface TestUser {
  token: string
  userId: string
  username: string
}

/** 注册一个唯一用户并返回其 Bearer token（后续请求用 Authorization: Bearer） */
export async function registerUnique(stack: TestStack): Promise<TestUser> {
  userSeq += 1
  const username = `e2e_${RUN_ID}_${userSeq}`
  const email = `${username}@e2e.test`
  const res = await stack.api('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, email, password: 'pass1234' }),
  })
  if (!res.ok)
    throw new Error(`E2E register failed (${res.status}): ${await res.text()}`)
  const body = await res.json() as { data: { token: string, user: { id: string } } }
  return { token: body.data.token, userId: body.data.user.id, username }
}

/** 带认证的 JSON 请求便捷封装 */
export function authJson(token: string, method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

/** 轮询直到谓词返回真或超时（默认 10s） */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  opts: { timeoutMs?: number, intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const intervalMs = opts.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs
  let last: T
  do {
    last = await fn()
    if (predicate(last))
      return last
    await Bun.sleep(intervalMs)
  } while (Date.now() < deadline)
  return last
}
