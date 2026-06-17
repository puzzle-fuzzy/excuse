import type { TestStack } from './fixtures/stack'
/**
 * E2E 冒烟测试 — 关键用户旅程，全程 fake provider，不访问真实 DashScope
 *
 * 覆盖旅程（docs/TODO.md §三、1 最小冒烟集）：
 *   1. 健康就绪（DB + 存储）
 *   2. 注册 / 登录（httpOnly cookie + JWT，E2E 用 Bearer 第 3 通道）
 *   3. 提交文本生成（同步，server 侧 fake provider）→ 记录 succeeded
 *   4. 创建 API Key + 调用 Gateway chat（gateway 侧 fake provider）→ OpenAI 形态响应
 *   5. 创建 Canvas 项目 + analyze 阶段（in-process fire-and-forget，fake provider）→ run succeeded
 *   6. 提交视频生成 → worker 处理器轮询完成（worker 侧 fake provider queryTask）→ 记录 succeeded
 *
 * 前置：DATABASE_URL 指向已 db:push 的库。见 e2e/README.md。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { authJson, pollUntil, registerUnique, startTestStack } from './fixtures/stack'

const TEXT_MODEL = 'qwen-max'
const VIDEO_MODEL = 'wan2.7-t2v'

const CANVAS_STORY = '在一片被晨雾笼罩的森林里，少年林川发现了一只会说话的白狐。白狐告诉他，只有找到传说中的星辰之井，才能解开森林沉睡的诅咒。于是两人踏上了冒险之旅。'

// Canvas analyze 阶段要求 LLM 返回符合 NovelAnalysis schema 的 JSON。
const NOVEL_ANALYSIS_JSON = JSON.stringify({
  summary: '少年林川与白狐前往星辰之井解除森林诅咒的冒险。',
  mainConflict: '林川需在森林彻底沉睡前找到星辰之井。',
  timeline: ['林川发现白狐', '得知星辰之井', '踏上冒险'],
  characterNames: ['林川', '白狐'],
  sceneNames: ['晨雾森林'],
})

let stack: TestStack

beforeAll(async () => {
  stack = await startTestStack()
})

afterAll(async () => {
  await stack.stop()
})

// ── 1. 健康就绪 ──────────────────────────────────────────
describe('health', () => {
  it('GET /api/health/live → 200', async () => {
    const res = await stack.api('/api/health/live')
    expect(res.ok).toBe(true)
    const body = await res.json() as { status: string }
    expect(body.status).toBe('ok')
  })

  it('GET /api/health/db → 200（真实 PG 已就绪）', async () => {
    const res = await stack.api('/api/health/db')
    expect(res.ok).toBe(true)
  })

  it('GET /api/health/ready → 200（DB + 存储可写）', async () => {
    const res = await stack.api('/api/health/ready')
    expect(res.ok).toBe(true)
  })
})

// ── 2. 认证旅程 ──────────────────────────────────────────
describe('auth journey', () => {
  it('注册 → /me；登录 → /me', async () => {
    const user = await registerUnique(stack)

    // Bearer token 取 me
    const me = await stack.api('/api/auth/me', authJson(user.token, 'GET'))
    expect(me.ok).toBe(true)
    const meBody = await me.json() as { data: { username: string } }
    expect(meBody.data.username).toBe(user.username)

    // 登录
    const login = await stack.api('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${user.username}@e2e.test`, password: 'pass1234' }),
    })
    expect(login.ok).toBe(true)
    const loginBody = await login.json() as { data: { token: string } }
    expect(loginBody.data.token).toBeTruthy()

    // 未认证访问受保护接口 → 401
    const unauth = await stack.api('/api/auth/me')
    expect(unauth.status).toBe(401)
  })
})

// ── 3. 文本生成（同步，server 侧 fake provider） ─────────
describe('text generation (sync, fake provider on server)', () => {
  it('提交文本生成 → 记录 succeeded + 输出落库 + sub-cent 计费落库 + provider 被调用', async () => {
    const user = await registerUnique(stack)
    const before = stack.control.calls.generate.length

    const res = await stack.api('/api/generate', authJson(user.token, 'POST', {
      model: TEXT_MODEL,
      parameters: { prompt: '讲一个简短的笑话' },
    }))
    expect(res.ok).toBe(true)
    const body = await res.json() as { success: boolean, record: { id: string, status: string, outputResult: { text?: string } | null } }
    expect(body.success).toBe(true)
    expect(body.record.status).toBe('succeeded')
    expect(body.record.outputResult?.text).toBeTruthy()

    // provider 注入生效：generate 被真实调用（非真实 DashScope）
    expect(stack.control.calls.generate.length).toBeGreaterThan(before)

    // sub-cent 计费落库验证：fake 文本 usage 1000/500 token 在 qwen-max 下 = 0.72 分（小数分）。
    // 计费列为 numeric(20,4)，该小数分能 reserve→debit 落库——这正是「integer 计费 vs sub-cent
    // 定价」冲突修复的直接证据（修复前会抛 22P02 invalid input syntax for type integer）。
    const costRes = await stack.api(`/api/records/${body.record.id}`, authJson(user.token, 'GET'))
    expect(costRes.ok).toBe(true)
    const costBody = await costRes.json() as { record: { cost: { totalPriceCents?: number } | null } }
    expect(costBody.record.cost?.totalPriceCents).toBeGreaterThan(0)
  })
})

// ── 4. API Key + Gateway（gateway 侧 fake provider） ─────
describe('api key + gateway (fake provider on gateway route)', () => {
  it('创建 API Key → 用 key 调 /v1/chat/completions → OpenAI 形态响应', async () => {
    const user = await registerUnique(stack)

    // 创建 gateway scope 的 API Key
    const keyRes = await stack.api('/api/keys', authJson(user.token, 'POST', { name: 'e2e', scope: 'gateway' }))
    expect(keyRes.ok).toBe(true)
    const keyBody = await keyRes.json() as { data: { key: string } }
    expect(keyBody.data.key).toMatch(/^exc_/)

    // 用 API Key（Bearer exc_xxx）调用 gateway
    const before = stack.control.calls.chatCompletion.length
    const chatRes = await stack.api('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${keyBody.data.key}` },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [{ role: 'user', content: '你好' }],
      }),
    })
    expect(chatRes.ok).toBe(true)
    const chatBody = await chatRes.json() as { object: string, choices: Array<{ message: { content: string } }> }
    expect(chatBody.object).toBe('chat.completion')
    expect(chatBody.choices[0]?.message.content).toBeTruthy()
    expect(stack.control.calls.chatCompletion.length).toBeGreaterThan(before)
  })
})

// ── 5. Canvas analyze（in-process fire-and-forget） ──────
describe('canvas analyze phase (fake provider, in-process)', () => {
  it('创建项目 + analyze 阶段 → run succeeded + 项目 analyzed', async () => {
    const user = await registerUnique(stack)

    // analyze 阶段经 chatCompletion 拉 LLM 并按 NovelAnalysis schema 解析 → 切到合法 JSON
    stack.control.setChatResponse(NOVEL_ANALYSIS_JSON)

    // 创建项目
    const createRes = await stack.api('/api/canvas/projects', authJson(user.token, 'POST', {
      title: 'e2e canvas',
      storyText: CANVAS_STORY,
    }))
    expect(createRes.ok).toBe(true)
    const projectId = (await createRes.json() as { data: { id: string } }).data.id

    // 触发 analyze（fire-and-forget，server 进程内用 fake client 跑）
    const analyzeRes = await stack.api(`/api/canvas/projects/${projectId}/analyze`, authJson(user.token, 'POST'))
    expect(analyzeRes.ok).toBe(true)
    const runId = (await analyzeRes.json() as { runId?: string }).runId
    expect(runId).toBeTruthy()

    // 轮询单个 run 直到 succeeded（fire-and-forget 在 server 进程内用 fake client 异步完成）
    const run = await pollUntil(
      async () => {
        const r = await stack.api(`/api/canvas/runs/${runId}`, authJson(user.token, 'GET'))
        if (!r.ok)
          return { status: 'unknown' }
        return (await r.json() as { data: { status: string } }).data
      },
      r => r.status === 'succeeded' || r.status === 'failed',
      { timeoutMs: 15_000 },
    )
    expect(run.status).toBe('succeeded')

    // 项目状态 analyzed + analysis 落库
    const projRes = await stack.api(`/api/canvas/projects/${projectId}`, authJson(user.token, 'GET'))
    expect(projRes.ok).toBe(true)
    const proj = (await projRes.json() as { data: { status: string, analysis: { summary?: string } | null } }).data
    expect(proj.status).toBe('analyzed')
    expect(proj.analysis?.summary).toBeTruthy()
  })
})

// ── 6. 视频生成（worker 处理器，fake provider queryTask） ──
describe('video generation (worker processor, fake provider)', () => {
  it('提交视频生成 → worker 处理完成 → 记录 succeeded', async () => {
    const user = await registerUnique(stack)

    const res = await stack.api('/api/generate', authJson(user.token, 'POST', {
      model: VIDEO_MODEL,
      parameters: { prompt: '一只橘猫在屋顶上奔跑', resolution: '720P', duration: 5 },
    }))
    expect(res.ok).toBe(true)
    const body = await res.json() as { record: { id: string, status: string } }
    // 视频为异步任务：提交后立即 processing
    expect(body.record.status).toBe('processing')
    const recordId = body.record.id

    // 驱动 worker 视频处理器（fake queryTask → SUCCEEDED + 桩下载）
    const before = stack.control.calls.queryTask.length
    await stack.processVideoRecord(recordId)
    expect(stack.control.calls.queryTask.length).toBeGreaterThan(before)

    // 记录终态 succeeded（GET /records/:id 返回 { success, record }，record 在顶层）
    const finalRes = await stack.api(`/api/records/${recordId}`, authJson(user.token, 'GET'))
    expect(finalRes.ok).toBe(true)
    const final = (await finalRes.json() as { record: { status: string, outputResult: { savedUrls?: string[] } | null } }).record
    expect(final.status).toBe('succeeded')
    expect(final.outputResult?.savedUrls?.length).toBeGreaterThan(0)
  })
})
