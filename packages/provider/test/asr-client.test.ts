import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { ASRClient } from '../src/asr-client'
import { __resetProviderCallObservers, registerProviderCallObserver } from '../src/dashscope-client'

// ── parseTranscription ──────────────────────────────────
// 纯逻辑测试，无需网络，不涉及 submitTranscription/queryTask

describe('ASRClient.parseTranscription', () => {
  const client = new ASRClient({ apiKey: 'test-key' })

  it('返回空数组当输入为 null', () => {
    expect(client.parseTranscription(null)).toEqual([])
  })

  it('返回空数组当输入为 undefined', () => {
    expect(client.parseTranscription(undefined)).toEqual([])
  })

  it('返回空数组当输入为非对象', () => {
    expect(client.parseTranscription('string')).toEqual([])
    expect(client.parseTranscription(42)).toEqual([])
  })

  it('返回空数组当输入缺少 transcripts 字段', () => {
    expect(client.parseTranscription({})).toEqual([])
    expect(client.parseTranscription({ other: 'data' })).toEqual([])
  })

  it('返回空数组当 transcripts 不是数组', () => {
    expect(client.parseTranscription({ transcripts: 'not-array' })).toEqual([])
    expect(client.parseTranscription({ transcripts: {} })).toEqual([])
  })

  it('解析单个 transcript 的句子列表', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '你好世界', begin_time: 0, end_time: 2000 },
            { text: '欢迎来到这里', begin_time: 2000, end_time: 5000 },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result).toHaveLength(2)
    expect(result[0]!.text).toBe('你好世界')
    expect(result[0]!.beginTime).toBe(0)
    expect(result[0]!.endTime).toBe(2000)
    expect(result[1]!.text).toBe('欢迎来到这里')
    expect(result[1]!.beginTime).toBe(2000)
    expect(result[1]!.endTime).toBe(5000)
  })

  it('解析带 speakerId 的句子', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '说话人1', begin_time: 0, end_time: 1000, speaker_id: 0 },
            { text: '说话人2', begin_time: 1000, end_time: 2000, speaker_id: 1 },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result[0]!.speakerId).toBe(0)
    expect(result[1]!.speakerId).toBe(1)
  })

  it('省略 speakerId 当不是 number 类型', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '你好', begin_time: 0, end_time: 1000 },
            { text: '世界', begin_time: 1000, end_time: 2000, speaker_id: 'spk1' },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result[0]!.speakerId).toBeUndefined()
    expect(result[1]!.speakerId).toBeUndefined()
  })

  it('合并多个 transcript 的句子', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '通道1句1', begin_time: 0, end_time: 1000 },
          ],
        },
        {
          sentences: [
            { text: '通道2句1', begin_time: 500, end_time: 1500 },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result).toHaveLength(2)
    expect(result[0]!.text).toBe('通道1句1')
    expect(result[1]!.text).toBe('通道2句1')
  })

  it('跳过缺少 sentences 数组的 transcript', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [{ text: '有效句', begin_time: 0, end_time: 1000 }],
        },
        {
          // 没有 sentences 字段
          text: '整体文本',
        },
        {
          sentences: 'not-array',
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result).toHaveLength(1)
    expect(result[0]!.text).toBe('有效句')
  })

  it('text 不是字符串时默认为空字符串', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: null, begin_time: 0, end_time: 1000 },
            { text: 123, begin_time: 1000, end_time: 2000 },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result[0]!.text).toBe('')
    expect(result[1]!.text).toBe('')
  })

  it('begin_time / end_time 不是数字时默认为 0', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '缺失时间', begin_time: 'bad', end_time: null },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result[0]!.beginTime).toBe(0)
    expect(result[0]!.endTime).toBe(0)
  })

  it('每个句子都有唯一 id', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '句1', begin_time: 0, end_time: 1000 },
            { text: '句2', begin_time: 1000, end_time: 2000 },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result[0]!.id).toBeTruthy()
    expect(result[1]!.id).toBeTruthy()
    expect(result[0]!.id).not.toBe(result[1]!.id)
  })

  it('空 transcripts 数组返回空句子列表', () => {
    expect(client.parseTranscription({ transcripts: [] })).toEqual([])
  })

  it('空 sentences 数组不产生输出', () => {
    expect(client.parseTranscription({ transcripts: [{ sentences: [] }] })).toEqual([])
  })
})

// ── submitTranscription provider observer ───────────────
// 验证 ASR 提交调用接入 provider observer（与 DashScopeClient 同机制）。

interface CapturedCall {
  model: string
  durationMs: number
  success: boolean
}

function mockFetchResponse(status: number, body: unknown) {
  const original = globalThis.fetch
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  ) as unknown as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

describe('ASRClient.submitTranscription — provider observer', () => {
  const client = new ASRClient({ apiKey: 'test-key' })
  let captured: CapturedCall[]
  let restoreFetch: () => void

  beforeEach(() => {
    __resetProviderCallObservers()
    captured = []
    registerProviderCallObserver((model, durationMs, success) => {
      captured.push({ model, durationMs, success })
    })
    restoreFetch = () => {}
  })

  afterEach(() => {
    restoreFetch()
    __resetProviderCallObservers()
  })

  it('提交成功 → 通知 observer（model=paraformer-v2, success=true, durationMs>=0）', async () => {
    restoreFetch = mockFetchResponse(200, { output: { task_id: 'asr-task-1' }, request_id: 'req-1' })

    const result = await client.submitTranscription('https://example.com/audio.mp3')

    expect(result.success).toBe(true)
    expect(result.taskId).toBe('asr-task-1')
    expect(captured).toHaveLength(1)
    expect(captured[0]!.model).toBe('paraformer-v2')
    expect(captured[0]!.success).toBe(true)
    expect(captured[0]!.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('HTTP 非 200 → 通知 observer（success=false）', async () => {
    restoreFetch = mockFetchResponse(400, { message: 'invalid audio url' })

    const result = await client.submitTranscription('https://example.com/bad.mp3')

    expect(result.success).toBe(false)
    expect(captured).toHaveLength(1)
    expect(captured[0]!.model).toBe('paraformer-v2')
    expect(captured[0]!.success).toBe(false)
  })

  it('成功响应但缺 task_id 与 request_id → 通知 observer（success=false）', async () => {
    // task_id 缺失、request_id 也缺失 → 命中「未返回 task_id」失败分支
    restoreFetch = mockFetchResponse(200, { output: {} })

    const result = await client.submitTranscription('https://example.com/audio.mp3')

    expect(result.success).toBe(false)
    expect(captured).toHaveLength(1)
    expect(captured[0]!.success).toBe(false)
  })

  it('网络异常（fetch reject）→ 通知 observer（success=false）', async () => {
    const original = globalThis.fetch
    globalThis.fetch = mock(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch
    restoreFetch = () => {
      globalThis.fetch = original
    }

    const result = await client.submitTranscription('https://example.com/audio.mp3')

    expect(result.success).toBe(false)
    expect(captured).toHaveLength(1)
    expect(captured[0]!.success).toBe(false)
  })
})
