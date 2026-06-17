import type { GenerationRecordRow } from '@excuse/db'
import { treaty } from '@elysia/eden'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { makeAccount, makeRecord, makeTestConfig, makeValidatedParams, signTestToken } from './helpers/test-factory'

/**
 * OpenAI 兼容网关测试 — /v1/chat/completions + /v1/models
 *
 * 覆盖:
 *   - 正常请求 → OpenAI 格式响应
 *   - 模型别名解析
 *   - 未知模型 → 404 error
 *   - 非文本模型 → 400 error
 *   - stream=true → 400 error
 *   - 缺少 user message → 400 error
 *   - 未认证 → 401
 *   - GET /v1/models → 文本模型列表
 */

// ─── Mock 数据 ────────────────────────────────────────

const mockRecord = makeRecord({
  id: 'rec-gw-001',
  taskId: 'gen_gw_001',
  model: 'qwen-max',
  status: 'succeeded',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
})

// ─── Mock 依赖 ──────────────────────────────────────────

const mockCreateGenerationRecord = mock<(values: Record<string, unknown>) => Promise<GenerationRecordRow>>(() => Promise.resolve(mockRecord))
const mockMarkGenerationFailed = mock<(id: string, error: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkGenerationSucceeded = mock<(id: string, output: Record<string, unknown>, cost?: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockReserveCredit = mock<(opts: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockDebitCredit = mock<(opts: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockRefundCredit = mock<(opts: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockFindApiKeyByHash = mock<(hash: string) => Promise<{ id: string, accountId: string, scope: string, rateLimitPerMinute: number | null, totalSpendCents: number, quotaMaxCents: number | null, quotaResetAt: Date | null } | null>>(() => Promise.resolve(null))
const mockTouchApiKeyLastUsed = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockGetAccountById = mock<() => Promise<unknown>>(() => Promise.resolve(makeAccount()))
const mockListGatewayUsageRecords = mock<(filter: Record<string, unknown>) => Promise<GenerationRecordRow[]>>(() => Promise.resolve([]))
const mockCheckAndResetApiKeyQuota = mock<(id: string) => Promise<boolean>>(() => Promise.resolve(false))
const mockIsApiKeyQuotaExceeded = mock<(id: string) => Promise<boolean>>(() => Promise.resolve(false))
const mockIncrementApiKeySpend = mock<(id: string, cents: number) => Promise<void>>(() => Promise.resolve(undefined))
const mockNotifyNotification = mock<(opts: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve({ id: 'n-1', read: false, createdAt: new Date() }))

const mockChatCompletion = mock<(model: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>>(() => Promise.resolve({
  success: true,
  output: { text: 'Hello! How can I help you?' },
  usage: { inputTokens: 10, outputTokens: 20 },
}))

const mockChatCompletionStream = mock<(model: string, params: Record<string, unknown>) => AsyncGenerator<Record<string, unknown>>>(function* () {
  // 默认 mock：3 个 delta + 1 个 done
  yield { type: 'text-stream', model: 'qwen3.7-plus', delta: 'Hello', done: false }
  yield { type: 'text-stream', model: 'qwen3.7-plus', delta: ' world', done: false }
  yield { type: 'text-stream', model: 'qwen3.7-plus', delta: '', usage: { inputTokens: 5, outputTokens: 2 }, done: true }
} as never)

const mockValidateAndMerge = mock<(_modelConfig: unknown, params: Record<string, unknown>) => { ok: boolean, params?: unknown, errors?: Array<{ field: string, message: string }> }>(() => ({
  ok: true,
  params: makeValidatedParams({}),
}))

mock.module('@excuse/db', () => ({
  createGenerationRecord: mockCreateGenerationRecord,
  markGenerationFailed: mockMarkGenerationFailed,
  markGenerationSucceeded: mockMarkGenerationSucceeded,
  reserveCredit: mockReserveCredit,
  debitCredit: mockDebitCredit,
  refundCredit: mockRefundCredit,
  findApiKeyByHash: mockFindApiKeyByHash,
  findRevokedApiKeyByHash: mock(async () => null),
  touchApiKeyLastUsed: mockTouchApiKeyLastUsed,
  getAccountById: mockGetAccountById,
  listGatewayUsageRecords: mockListGatewayUsageRecords,
  checkAndResetApiKeyQuota: mockCheckAndResetApiKeyQuota,
  isApiKeyQuotaExceeded: mockIsApiKeyQuotaExceeded,
  incrementApiKeySpend: mockIncrementApiKeySpend,
  notifyNotification: mockNotifyNotification,
  pgClient: { listen: async () => {} },
}))

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {
    chatCompletion = mockChatCompletion
    chatCompletionStream = mockChatCompletionStream
  },
  AssetStorage: class {},
  getModelById: (id: string) => {
    const models: Record<string, Record<string, unknown>> = {
      'qwen-max': { id: 'qwen-max', category: 'text', requestType: 'chat', pricing: { inputPriceCents: 240, outputPriceCents: 960, unit: 'token' }, parameters: [
        { name: 'prompt', type: 'text', required: true },
        { name: 'temperature', type: 'number', defaultValue: 0.7 },
        { name: 'max_tokens', type: 'number', defaultValue: 1500 },
      ] },
      'qwen3.7-plus': { id: 'qwen3.7-plus', category: 'text', requestType: 'openai-chat', pricing: { inputPriceCents: 160, outputPriceCents: 640, unit: 'token' }, parameters: [
        { name: 'prompt', type: 'text', required: true },
        { name: 'max_tokens', type: 'number', defaultValue: 1500 },
      ] },
      'qwen-plus': { id: 'qwen-plus', category: 'text', requestType: 'chat', pricing: { inputPriceCents: 80, outputPriceCents: 200, unit: 'token' }, parameters: [
        { name: 'prompt', type: 'text', required: true },
      ] },
      'qwen-image-2.0-pro': { id: 'qwen-image-2.0-pro', category: 'image', pricing: { inputPriceCents: 25, unit: 'image' }, parameters: [] },
    }
    return models[id] ?? null
  },
  mergeWithDefaults: (_modelConfig: unknown, params: Record<string, unknown>) => params,
  getModelsByCategory: (cat: string) => {
    const all = [
      { id: 'qwen-max', name: '千问 Max', category: 'text' },
      { id: 'qwen-plus', name: '千问 Plus', category: 'text' },
    ]
    return cat === 'text' ? all : []
  },
  validateModelParameters: () => ({ valid: true, errors: [] }),
  validateAndMerge: (modelConfig: unknown, params: Record<string, unknown>) => mockValidateAndMerge(modelConfig, params),
  MODELS: {},
}))

mock.module('@excuse/billing', () => ({
  calculateCost: () => ({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 }),
  aggregateStatistics: () => ({ totalCents: 0, totalYuan: 0, byCategory: [], byModel: [], dailyTrend: [] }),
}))

// eslint-disable-next-line import/first
import { createOpenAIGatewayRoutes } from '../src/routes/openai-gateway'
// eslint-disable-next-line import/first
import { resetCooldowns } from '../src/services/notification-cooldown'
// eslint-disable-next-line import/first
import { createServerContext } from '../src/context'

// ─── 测试配置 ──────────────────────────────────────────

const testConfig = makeTestConfig({ jwtSecret: 'openai-gw-test-secret' })

async function getAuthHeaders(accountId = 'acc-001') {
  const token = await signTestToken(testConfig.jwtSecret, accountId)
  return { Authorization: `Bearer ${token}` }
}

function createGatewayApp() {
  const ctx = createServerContext(testConfig)
  return new Elysia()
    .use(createOpenAIGatewayRoutes(testConfig, ctx))
}

/** 从 Eden error 提取 OpenAI error message */
function getErrorMessage(error: unknown): string {
  const edenErr = error as { value?: { error?: { message?: string } } | { error?: string }, status?: number } | null
  if (!edenErr?.value)
    return ''
  const val = edenErr.value
  // OpenAI error format: { error: { message, type, code } }
  if (typeof val === 'object' && 'error' in val) {
    const errObj = (val as Record<string, unknown>).error
    if (typeof errObj === 'object' && errObj !== null && 'message' in errObj)
      return (errObj as { message: string }).message
    if (typeof errObj === 'string')
      return errObj
  }
  return String(val)
}

/** 从 Eden error 提取 OpenAI error.code（如 model_not_found / insufficient_balance） */
function getErrorCode(error: unknown): string {
  const edenErr = error as { value?: { error?: { code?: string } } } | null
  const errObj = edenErr?.value as Record<string, unknown> | undefined
  if (errObj && typeof errObj === 'object' && 'error' in errObj) {
    const inner = (errObj as Record<string, unknown>).error
    if (typeof inner === 'object' && inner !== null && 'code' in inner)
      return (inner as { code?: string }).code ?? ''
  }
  return ''
}

// ─── 测试 ──────────────────────────────────────────

describe('OpenAI 网关', () => {
  beforeEach(() => {
    mockCreateGenerationRecord.mockImplementation(() => Promise.resolve(mockRecord))
    mockMarkGenerationFailed.mockImplementation(() => Promise.resolve(undefined))
    mockMarkGenerationSucceeded.mockImplementation(() => Promise.resolve(undefined))
    mockReserveCredit.mockImplementation(() => Promise.resolve(undefined))
    mockDebitCredit.mockClear()
    mockRefundCredit.mockClear()
    mockListGatewayUsageRecords.mockClear()
    mockListGatewayUsageRecords.mockImplementation(() => Promise.resolve([]))
    mockValidateAndMerge.mockImplementation((_modelConfig, params) => ({
      ok: true,
      params: makeValidatedParams(params),
    }))
    mockChatCompletion.mockImplementation(() => Promise.resolve({
      success: true,
      output: { text: 'Hello! How can I help you?' },
      usage: { inputTokens: 10, outputTokens: 20 },
    }))
    mockChatCompletionStream.mockImplementation(function* () {
      yield { type: 'text-stream', model: 'qwen3.7-plus', delta: 'Hello', done: false }
      yield { type: 'text-stream', model: 'qwen3.7-plus', delta: ' world', done: false }
      yield { type: 'text-stream', model: 'qwen3.7-plus', delta: '', usage: { inputTokens: 5, outputTokens: 2 }, done: true }
    } as never)
    // 重置通知冷却状态，避免跨用例污染
    resetCooldowns()
    mockNotifyNotification.mockClear()
    mockIsApiKeyQuotaExceeded.mockImplementation(() => Promise.resolve(false))
    mockCheckAndResetApiKeyQuota.mockImplementation(() => Promise.resolve(false))
    mockFindApiKeyByHash.mockImplementation(() => Promise.resolve(null))
  })

  describe('POST /v1/chat/completions', () => {
    it('正常请求返回 OpenAI 格式响应', async () => {
      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { data, error } = await client.v1.chat.completions.post({
        model: 'qwen-max',
        messages: [{ role: 'user', content: '你好' }],
      }, { headers })

      expect(error).toBeNull()
      const result = data as { id: string, object: string, model: string, choices: Array<{ message: { role: string, content: string }, finish_reason: string }>, usage: { prompt_tokens: number, completion_tokens: number, total_tokens: number } }
      expect(result.object).toBe('chat.completion')
      expect(result.model).toBe('qwen-max')
      expect(result.choices).toHaveLength(1)
      expect(result.choices[0].message.role).toBe('assistant')
      expect(result.choices[0].message.content).toBe('Hello! How can I help you?')
      expect(result.choices[0].finish_reason).toBe('stop')
      expect(result.usage.prompt_tokens).toBe(10)
      expect(result.usage.completion_tokens).toBe(20)
      expect(result.usage.total_tokens).toBe(30)
      expect(mockCreateGenerationRecord).toHaveBeenCalled()
      expect(mockMarkGenerationSucceeded).toHaveBeenCalled()
      expect(mockReserveCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        generationRecordId: 'rec-gw-001',
        amountCents: 1,
      }))
      expect(mockDebitCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        generationRecordId: 'rec-gw-001',
        actualCents: 1,
      }))
    })

    it('模型别名解析 — gpt-4 → qwen-max', async () => {
      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { data, error } = await client.v1.chat.completions.post({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      }, { headers })

      expect(error).toBeNull()
      const response = data as { id: string, object: string, model: string }
      expect(response.model).toBe('gpt-4')
      expect(mockCreateGenerationRecord).toHaveBeenCalled()
    })

    it('创建记录时写入 source=gateway 和 requestedModel（用户原始模型名）', async () => {
      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { error } = await client.v1.chat.completions.post({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
      }, { headers })

      expect(error).toBeNull()
      expect(mockCreateGenerationRecord).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        model: 'qwen-plus',
        category: 'text',
        inputParams: expect.objectContaining({
          source: 'gateway',
          requestedModel: 'gpt-4o-mini',
        }),
      }))
    })

    it('未知模型 → 404 + code=model_not_found', async () => {
      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { error } = await client.v1.chat.completions.post({
        model: 'unknown-model',
        messages: [{ role: 'user', content: 'Hello' }],
      }, { headers })

      expect(error).toBeTruthy()
      const errBody = getErrorMessage(error)
      expect(errBody).toContain('not found')
      expect(getErrorCode(error)).toBe('model_not_found')
    })

    it('非文本模型 → 400 + code=invalid_model', async () => {
      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { error } = await client.v1.chat.completions.post({
        model: 'qwen-image-2.0-pro',
        messages: [{ role: 'user', content: 'Hello' }],
      }, { headers })

      expect(error).toBeTruthy()
      const errBody = getErrorMessage(error)
      expect(errBody).toContain('not a text model')
      expect(getErrorCode(error)).toBe('invalid_model')
    })

    it('stream=true + chat 协议模型（qwen-max）→ 不再 400（chat 协议现在也支持流式）', async () => {
      const headers = await getAuthHeaders()
      const app = createGatewayApp()

      const response = await app.handle(new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({
          model: 'qwen-max',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        }),
      }))

      // chat 协议模型现在也支持流式 → 200 SSE
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
    })

    it('缺少 user message → 400 + code=missing_user_message', async () => {
      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { error } = await client.v1.chat.completions.post({
        model: 'qwen-max',
        messages: [{ role: 'system', content: 'You are helpful' }],
      }, { headers })

      expect(error).toBeTruthy()
      const errBody = getErrorMessage(error)
      expect(errBody).toContain('No user message')
      expect(getErrorCode(error)).toBe('missing_user_message')
    })

    it('参数校验失败 → 400 + code=invalid_parameters', async () => {
      mockValidateAndMerge.mockImplementation(() => ({
        ok: false,
        errors: [{ field: 'temperature', message: 'must be between 0 and 2' }],
      }))

      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { error } = await client.v1.chat.completions.post({
        model: 'qwen-max',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 99,
      }, { headers })

      expect(error).toBeTruthy()
      expect(getErrorCode(error)).toBe('invalid_parameters')
      expect(getErrorMessage(error)).toContain('temperature')
    })

    it('provider 失败 → 500 + code=generation_failed + refund', async () => {
      mockChatCompletion.mockImplementation(() => Promise.resolve({
        success: false,
        error: 'DashScope error',
      }))

      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { error } = await client.v1.chat.completions.post({
        model: 'qwen-max',
        messages: [{ role: 'user', content: 'Hello' }],
      }, { headers })

      expect(error).toBeTruthy()
      expect(getErrorCode(error)).toBe('generation_failed')
      expect(mockMarkGenerationFailed).toHaveBeenCalled()
      // 成本为 1 cent，预扣成功 → 失败后必须退款
      expect(mockRefundCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        generationRecordId: 'rec-gw-001',
      }))
    })

    it('余额不足 → 402 + code=insufficient_balance', async () => {
      mockReserveCredit.mockImplementation(() => Promise.reject(new Error('Insufficient balance')))

      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { error } = await client.v1.chat.completions.post({
        model: 'qwen-max',
        messages: [{ role: 'user', content: 'Hello' }],
      }, { headers })

      expect(error).toBeTruthy()
      expect(getErrorCode(error)).toBe('insufficient_balance')
      expect(mockMarkGenerationFailed).toHaveBeenCalled()
    })

    it('provider 失败 → 触发 provider_anomaly 通知（系统风险）', async () => {
      mockChatCompletion.mockImplementation(() => Promise.resolve({
        success: false,
        error: 'DashScope error',
      }))

      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      await client.v1.chat.completions.post({
        model: 'qwen-max',
        messages: [{ role: 'user', content: 'Hello' }],
      }, { headers })

      // 编排器在 provider 抛错时 fire-and-forget 触发 notifyProviderFailure
      // 等待微任务/异步通知落定
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(mockNotifyNotification).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        type: 'provider_anomaly',
      }))
    })

    it('API Key 额度已用尽 → 429 + api_key_quota 通知', async () => {
      // 配置 API Key 鉴权：scope=gateway，额度已用尽（100/100）
      mockFindApiKeyByHash.mockImplementation(() => Promise.resolve({
        id: 'key-001',
        accountId: 'acc-001',
        scope: 'gateway',
        rateLimitPerMinute: null,
        totalSpendCents: 100,
        quotaMaxCents: 100,
        quotaResetAt: null,
      }))
      mockIsApiKeyQuotaExceeded.mockImplementation(() => Promise.resolve(true))

      const app = createGatewayApp()
      const response = await app.handle(new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer exc_testkey_quota' },
        body: JSON.stringify({
          model: 'qwen-max',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }))

      expect(response.status).toBe(429)
      const body = await response.json() as { error?: { code?: string } }
      expect(body.error?.code).toBe('api_key_quota_exceeded')
      // 额度用尽通知（非阻塞）— 等待落定
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(mockNotifyNotification).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        type: 'api_key_quota',
      }))
    })

    it('API Key 额度即将用尽（80%）成功调用 → 触发 api_key_quota 预警', async () => {
      // 已用 75，本次成本 1（mock calculateCost 返回 1 cent）→ 投射 76，未达 80%，不触发；
      // 改为已用 80 → 投射 81 ≥ 80%，触发即将用尽预警
      mockFindApiKeyByHash.mockImplementation(() => Promise.resolve({
        id: 'key-002',
        accountId: 'acc-001',
        scope: 'gateway',
        rateLimitPerMinute: null,
        totalSpendCents: 80,
        quotaMaxCents: 100,
        quotaResetAt: null,
      }))

      const app = createGatewayApp()
      const response = await app.handle(new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer exc_testkey_approaching' },
        body: JSON.stringify({
          model: 'qwen-max',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }))

      expect(response.status).toBe(200)
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(mockNotifyNotification).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        type: 'api_key_quota',
      }))
      // 额度递增也被调用
      expect(mockIncrementApiKeySpend).toHaveBeenCalledWith('key-002', 1)
    })

    it('未认证 → 401', async () => {
      const app = createGatewayApp()
      const client = treaty(app)

      const { error } = await client.v1.chat.completions.post({
        model: 'qwen-max',
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(error).toBeTruthy()
    })
  })

  describe('POST /v1/chat/completions (stream)', () => {
    /** 用 app.handle(Request) 直接拉 SSE Response body 文本 */
    async function postStream(body: unknown, headers: Record<string, string>): Promise<{ status: number, contentType: string, text: string }> {
      const app = createGatewayApp()
      const response = await app.handle(new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }))
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        text: await response.text(),
      }
    }

    it('stream=true + openai-chat 模型 → 200 + text/event-stream + 至少 2 个 data 帧 + [DONE]', async () => {
      const headers = await getAuthHeaders()
      const { status, contentType, text } = await postStream({
        model: 'qwen3.7-plus',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }, headers)

      expect(status).toBe(200)
      expect(contentType).toContain('text/event-stream')
      // 至少 2 个 data: {...} 帧 + 1 个 [DONE]
      const dataFrames = text.match(/^data: \{.*\}$/gm) ?? []
      expect(dataFrames.length).toBeGreaterThanOrEqual(2)
      expect(text).toContain('data: [DONE]')
      // 首帧带 role: assistant
      expect(text).toContain('"role":"assistant"')
    })

    it('stream=true + chat 协议模型（qwen-max）→ 200 SSE（chat 协议现在也支持流式）', async () => {
      const headers = await getAuthHeaders()
      const { status, contentType, text } = await postStream({
        model: 'qwen-max',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }, headers)

      expect(status).toBe(200)
      expect(contentType).toContain('text/event-stream')
      // 至少 2 个 data: {...} 帧 + [DONE]
      const dataFrames = text.match(/^data: \{.*\}$/gm) ?? []
      expect(dataFrames.length).toBeGreaterThanOrEqual(2)
      expect(text).toContain('data: [DONE]')
    })

    it('stream=true + 未认证 → 401', async () => {
      const { status } = await postStream({
        model: 'qwen3.7-plus',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }, {})

      expect(status).toBe(401)
    })

    it('流式成功路径：markGenerationSucceeded / debitCredit / audit 都被调用', async () => {
      const headers = await getAuthHeaders()
      await postStream({
        model: 'qwen3.7-plus',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }, headers)

      expect(mockMarkGenerationSucceeded).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ type: 'text', text: 'Hello world' }),
        expect.objectContaining({ billable: true, source: 'actual' }),
      )
      expect(mockDebitCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
        actualCents: 1,
      }))
    })

    it('流式失败路径：chatCompletionStream throw → markGenerationFailed / refundCredit 被调用', async () => {
      mockChatCompletionStream.mockImplementation((function* () {
        yield { type: 'text-stream', model: 'qwen3.7-plus', delta: 'partial', done: false }
        throw new Error('upstream stream broken')
      }) as never)

      const headers = await getAuthHeaders()
      const { status, text } = await postStream({
        model: 'qwen3.7-plus',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }, headers)

      // 流中断：status 仍 200（已经返回了 SSE response），但 markFailed + refund 被调用
      expect(status).toBe(200)
      expect(text).toContain('partial')
      expect(mockMarkGenerationFailed).toHaveBeenCalledWith(expect.any(String), 'upstream stream broken')
      expect(mockRefundCredit).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'acc-001',
      }))
    })
  })

  describe('GET /v1/models', () => {
    it('返回文本模型列表', async () => {
      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { data, error } = await client.v1.models.get({ headers })

      expect(error).toBeNull()
      expect(data).toBeTruthy()
      expect((data! as { object: string, data: Array<{ object: string }> }).object).toBe('list')
      expect((data! as { object: string, data: Array<{ object: string }> }).data.length).toBeGreaterThanOrEqual(1)
      expect((data! as { object: string, data: Array<{ object: string }> }).data[0].object).toBe('model')
    })
  })

  describe('GET /v1/usage', () => {
    it('未认证 → 401', async () => {
      const app = createGatewayApp()
      const client = treaty(app)

      const { error } = await client.v1.usage.get({})

      expect(error).toBeTruthy()
      expect(error?.status).toBe(401)
    })

    it('返回聚合摘要 + 最近调用列表（含 source=gateway + requestedModel）', async () => {
      mockListGatewayUsageRecords.mockImplementation(() => Promise.resolve([
        makeRecord({
          id: 'rec-usage-1',
          model: 'qwen-max',
          status: 'succeeded',
          cost: { unit: 'token', totalPriceCents: 12, totalPrice: 0.12, inputTokens: 100, outputTokens: 50 },
          totalPriceCents: 12,
          errorMessage: null,
          inputParams: { source: 'gateway', requestedModel: 'gpt-4o' },
          createdAt: new Date('2024-06-13T00:00:00Z'),
        }),
        makeRecord({
          id: 'rec-usage-2',
          model: 'qwen-plus',
          status: 'failed',
          cost: null,
          totalPriceCents: 0,
          errorMessage: 'DashScope error',
          inputParams: { source: 'gateway', requestedModel: 'gpt-4o-mini' },
          createdAt: new Date('2024-06-12T00:00:00Z'),
        }),
      ]))

      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { data, error } = await client.v1.usage.get({ headers })

      expect(error).toBeNull()
      const result = data as {
        totalCalls: number
        succeededCalls: number
        failedCalls: number
        totalTokens: number
        totalPriceCents: number
        items: Array<{
          id: string
          model: string
          requestedModel: string | null
          status: string
          inputTokens: number | null
          outputTokens: number | null
          totalTokens: number | null
          totalPriceCents: number
          errorMessage: string | null
          createdAt: string
        }>
      }
      expect(result.totalCalls).toBe(2)
      expect(result.succeededCalls).toBe(1)
      expect(result.failedCalls).toBe(1)
      expect(result.totalTokens).toBe(150)
      expect(result.totalPriceCents).toBe(12)
      expect(result.items).toHaveLength(2)
      const [first, second] = result.items
      expect(first.id).toBe('rec-usage-1')
      expect(first.model).toBe('qwen-max')
      expect(first.requestedModel).toBe('gpt-4o')
      expect(first.status).toBe('succeeded')
      expect(first.inputTokens).toBe(100)
      expect(first.outputTokens).toBe(50)
      expect(first.totalTokens).toBe(150)
      expect(first.totalPriceCents).toBe(12)
      expect(first.errorMessage).toBeNull()
      // Eden treaty 可能把 ISO 日期字符串反序列化成 Date，统一转 ISO 字符串比较
      expect(new Date(first.createdAt).toISOString()).toBe('2024-06-13T00:00:00.000Z')
      expect(second.id).toBe('rec-usage-2')
      expect(second.status).toBe('failed')
      expect(second.requestedModel).toBe('gpt-4o-mini')
      expect(second.errorMessage).toBe('DashScope error')
      expect(second.inputTokens).toBeNull()
      expect(second.outputTokens).toBeNull()
      expect(second.totalTokens).toBeNull()
      expect(second.totalPriceCents).toBe(0)
    })

    it('默认参数 → days=30 / limit=50 / offset=0，并构造 30 天窗口', async () => {
      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      await client.v1.usage.get({ headers })

      expect(mockListGatewayUsageRecords).toHaveBeenCalledTimes(1)
      const filter = mockListGatewayUsageRecords.mock.calls[0]?.[0] as {
        accountId: string
        createdFrom: Date
        createdTo: Date
        limit: number
        offset: number
      }
      expect(filter.accountId).toBe('acc-001')
      expect(filter.limit).toBe(50)
      expect(filter.offset).toBe(0)
      expect(filter.createdFrom).toBeInstanceOf(Date)
      expect(filter.createdTo).toBeInstanceOf(Date)
      const diffMs = filter.createdTo.getTime() - filter.createdFrom.getTime()
      // 30 天 ±1 小时容忍时钟漂移
      expect(diffMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000)
      expect(diffMs).toBeLessThan(31 * 24 * 60 * 60 * 1000)
    })

    it('days=7 / limit=20 透传到 repository', async () => {
      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      await client.v1.usage.get({ query: { days: 7, limit: 20 }, headers })

      expect(mockListGatewayUsageRecords).toHaveBeenCalledTimes(1)
      const filter = mockListGatewayUsageRecords.mock.calls[0]?.[0] as {
        accountId: string
        createdFrom: Date
        createdTo: Date
        limit: number
        offset: number
      }
      expect(filter.accountId).toBe('acc-001')
      expect(filter.limit).toBe(20)
      const diffMs = filter.createdTo.getTime() - filter.createdFrom.getTime()
      expect(diffMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000)
      expect(diffMs).toBeLessThan(8 * 24 * 60 * 60 * 1000)
    })

    it('limit > 100 被 schema 拒绝 → 不调用 repository', async () => {
      const headers = await getAuthHeaders()
      const app = createGatewayApp()
      const client = treaty(app)

      const { error } = await client.v1.usage.get({ query: { limit: 200 }, headers })

      expect(error).toBeTruthy()
      // Elysia schema 校验失败返回 422
      expect(error?.status).toBe(422)
      expect(mockListGatewayUsageRecords).not.toHaveBeenCalled()
    })
  })
})
