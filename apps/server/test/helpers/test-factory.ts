/**
 * 共享测试工厂函数
 *
 * 为 server 测试提供类型安全的数据构造器，替代各文件中重复的 makeAccount / testConfig / makeRecord 等。
 * 所有工厂都接受 Partial<Overrides> 参数，未覆盖的字段使用合理默认值。
 */
import type { AccountRow, GenerationRecordRow, UploadedFileRow } from '@excuse/db'
import type { ValidatedModelParameters } from '@excuse/provider'
import type { ServerConfig } from '../../src/config'

// ===== ValidatedModelParameters 测试构造器 =====

/**
 * 测试专用 branded type 构造器 — 集中替代散落的 `as any`
 *
 * ValidatedModelParameters 是 branded type（declare unique symbol __validatedBrand），
 * 正常代码只能通过 validateAndMerge() 构造。测试 mock 需要绕过 brand，
 * 此 helper 是唯一允许的绕过点（单点管控，不用在各测试文件写 `as any`）。
 */
export function makeValidatedParams(params: Record<string, unknown>): ValidatedModelParameters {
  return params as ValidatedModelParameters
}

// ===== Account 工厂 =====

/**
 * 构造 AccountRow 测试数据
 *
 * 默认值: id='acc-test', username='testuser', email='test@example.com'
 * 传入 overrides 覆盖任意字段，保留其余默认值
 */
export function makeAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc-test',
    username: 'testuser',
    email: 'test@example.com',
    password: 'hashed-password',
    avatar: null,
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

// ===== GenerationRecord 工厂 =====

/** 构造成功状态的 GenerationRecordRow 测试数据 */
export function makeRecord(overrides: Partial<GenerationRecordRow> = {}): GenerationRecordRow {
  const base = {
    id: 'rec-001',
    accountId: 'acc-001',
    taskId: 'gen_123_abc',
    model: 'qwen-max',
    category: 'text',
    status: 'succeeded',
    inputParams: {},
    outputResult: { type: 'text', text: 'hello' },
    cost: { unit: 'token', totalPriceCents: 1, totalPrice: 0.01 },
    errorMessage: null,
    dedupeKey: null,
    cancelRequestedAt: null,
    providerCancelStatus: 'not_requested',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
  return base as GenerationRecordRow
}

/** 构造 failed 状态的 GenerationRecordRow */
export function makeFailedRecord(overrides: Partial<GenerationRecordRow> = {}): GenerationRecordRow {
  return makeRecord({
    id: 'rec-failed-001',
    taskId: 'gen_old_task',
    status: 'failed',
    inputParams: { prompt: '你好' },
    outputResult: null,
    cost: null,
    errorMessage: 'previous error',
    dedupeKey: 'qwen-max:{"prompt":"你好"}',
    ...overrides,
  })
}

/** 构造 processing 状态的 GenerationRecordRow */
export function makeProcessingRecord(overrides: Partial<GenerationRecordRow> = {}): GenerationRecordRow {
  return makeRecord({
    id: 'rec-proc-001',
    taskId: 'gen_proc_task',
    status: 'processing',
    inputParams: { prompt: 'test' },
    outputResult: { type: 'processing', taskId: 'gen_proc_task', status: 'processing' },
    cost: null,
    errorMessage: null,
    dedupeKey: null,
    ...overrides,
  })
}

// ===== UploadedFile 工厂 =====

/** 构造 UploadedFileRow 测试数据 */
export function makeUploadedFile(overrides: Partial<UploadedFileRow> = {}): UploadedFileRow {
  return {
    id: 'file-001',
    accountId: 'acc-test',
    fileName: 'test.png',
    fileSize: 1024,
    mimeType: 'image/png',
    storagePath: 'ref_123/test.png',
    publicUrl: '/uploads/ref_123/test.png',
    purpose: 'reference',
    metadata: null,
    deletedAt: null,
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }
}

// ===== ServerConfig 工厂 =====

/**
 * 构造测试用 ServerConfig
 *
 * 默认值适用于大多数 server 测试场景（port=0, 空 DB URL, 1h JWT 过期）。
 * jwtSecret 每个测试文件应使用唯一值以避免签名冲突。
 */
export function makeTestConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    databaseUrl: '',
    dashscopeApiKey: '',
    dashscopeBaseUrl: '',
    storageRoot: '',
    frontendUrl: '',
    workerPollIntervalMs: 0,
    jwtSecret: 'test-secret',
    jwtExpiresIn: '1h',
    oss: undefined,
    metricsAccessToken: undefined,
    metricsAllowedCidrs: ['127.0.0.1/32', '::1/128'],
    workerMetricsUrl: undefined,
    adminUserIds: [],
    providerHttpTimeoutMs: 60_000,
    providerStreamIdleTimeoutMs: 30_000,
    processStartTime: 0,
    ...overrides,
  }
}

// ===== JWT 签发辅助 =====

/**
 * 通过独立 JWT 应用签发 token（不依赖 auth 路由）
 *
 * 适用于不需要测试注册/登录流程、只需有效 token 的场景（如 billing 测试）。
 * 返回签发给指定 accountId 的 JWT 字符串。
 */
export async function signTestToken(jwtSecret: string, accountId: string): Promise<string> {
  const { Elysia } = await import('elysia')
  const jwtApp = new Elysia()
    .use((await import('@elysia/jwt')).jwt({ name: 'jwt', secret: jwtSecret, exp: '1h' }))
    .get('/sign', async ({ jwt }) => jwt.sign({ sub: accountId }))

  const { treaty } = await import('@elysia/eden')
  const jwtClient = treaty(jwtApp)
  const { data } = await jwtClient.sign.get()
  return data as unknown as string
}

// ===== Eden 错误响应提取 =====

/**
 * Eden 错误响应结构（非 2xx 时 Eden 将 body 放入 error.value）
 */
interface EdenErrorResponse {
  status?: number
  statusText?: string
  value?: unknown
}

/**
 * 从 Eden 响应中提取 data 体
 *
 * Eden Treaty 的 data 类型是从 Elysia 路由推导的，与 @excuse/shared 的
 * 手动类型有细微差异。测试中直接访问 res.data 会遇到类型不兼容问题，
 * 此 helper 集中处理类型转换，避免各测试文件散落 `as any`。
 *
 * @returns Eden 响应中的 data 字段（类型转为 T）
 */
export function extractEdenData<T = Record<string, any>>(res: { data: unknown, error: unknown }): T {
  return res.data as T
}

/**
 * 从 Eden 响应中提取错误体
 *
 * HTTP 状态码整改后，路由错误响应使用 4xx 状态码。
 * Eden treaty 将非 2xx 响应体放入 error.value 而非 data。
 * 此 helper 统一提取错误消息和状态码。
 *
 * @returns 错误信息对象，或 null（非错误响应时）
 */
export function extractEdenError(res: { data: unknown, error: unknown }): { success: false, error: string, status: number } | null {
  if (!res.error)
    return null
  const edenErr = res.error as EdenErrorResponse
  const body = edenErr.value as { success?: boolean, error?: string } | undefined
  if (!body)
    return null
  return {
    success: false,
    error: body.error ?? 'unknown error',
    status: edenErr.status ?? 0,
  }
}
