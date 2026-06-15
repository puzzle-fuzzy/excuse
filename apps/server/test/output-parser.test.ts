import type { DashScopeTaskOutput, ImageProviderOutput, TextProviderOutput, VideoTaskProviderOutput } from '@excuse/provider'
import { describe, expect, it } from 'bun:test'
import { extractImageUrls, parseProviderOutput } from '../src/modules/generation/output-parser'

describe('parseProviderOutput', () => {
  // ── 1. TextProviderOutput ────────────────────────────────

  it('文本 provider output → TextOutputResult', () => {
    const input: TextProviderOutput = {
      type: 'text',
      text: 'Hello world',
      raw: { some: 'raw' },
    }
    const result = parseProviderOutput(input)
    expect(result).toEqual({ type: 'text', text: 'Hello world' })
  })

  // ── 2. ImageProviderOutput ────────────────────────────────

  it('图片 provider output → ImageOutputResult', () => {
    const input: ImageProviderOutput = {
      type: 'image',
      urls: ['https://img1.jpg', 'https://img2.jpg'],
      raw: {},
    }
    const result = parseProviderOutput(input)
    expect(result.type).toBe('image')
    if (result.type === 'image') {
      expect(result.urls).toEqual(['https://img1.jpg', 'https://img2.jpg'])
      expect(result.savedUrls).toEqual([])
    }
  })

  // ── 3. VideoTaskProviderOutput ────────────────────────────

  it('处理中 provider output → ProcessingOutputResult', () => {
    const input: VideoTaskProviderOutput = {
      type: 'processing',
      taskId: 'task-123',
      status: 'submitted',
      raw: {},
    }
    const result = parseProviderOutput(input)
    expect(result).toEqual({
      type: 'processing',
      taskId: 'task-123',
      status: 'submitted',
    })
  })

  // ── 4. DashScopeTaskOutput — video completed ──────────────

  it('DashScope 视频完成 → VideoOutputResult', () => {
    const input: DashScopeTaskOutput = {
      video_url: 'https://video.mp4',
    }
    const result = parseProviderOutput(input)
    expect(result.type).toBe('video')
    if (result.type === 'video') {
      expect(result.video_url).toBe('https://video.mp4')
      expect(result.savedUrls).toEqual([])
      expect(result.originalUrl).toBeUndefined()
    }
  })

  it('DashScope 视频完成且 savedUrls 过滤非字符串项', () => {
    const input: DashScopeTaskOutput = {
      video_url: 'https://video.mp4',
      savedUrls: ['https://saved1.jpg', 42, null, 'https://saved2.jpg'],
    }
    const result = parseProviderOutput(input)
    if (result.type === 'video') {
      expect(result.savedUrls).toEqual(['https://saved1.jpg', 'https://saved2.jpg'])
    }
  })

  it('DashScope 视频完成且 string 类型 originalUrl 保留', () => {
    const input: DashScopeTaskOutput = {
      video_url: 'https://video.mp4',
      originalUrl: 'https://original.mp4',
    }
    const result = parseProviderOutput(input)
    if (result.type === 'video') {
      expect(result.originalUrl).toBe('https://original.mp4')
    }
  })

  it('DashScope 视频完成且非 string 类型 originalUrl 丢弃', () => {
    const input: DashScopeTaskOutput = {
      video_url: 'https://video.mp4',
      originalUrl: 123,
    }
    const result = parseProviderOutput(input)
    if (result.type === 'video') {
      expect(result.originalUrl).toBeUndefined()
    }
  })

  // ── 5. DashScopeTaskOutput — image completed ──────────────

  it('DashScope 图片完成（来自 url results）', () => {
    const input: DashScopeTaskOutput = {
      results: [{ url: 'https://img1.jpg' }, { url: 'https://img2.jpg' }],
    }
    const result = parseProviderOutput(input)
    expect(result.type).toBe('image')
    if (result.type === 'image') {
      expect(result.urls).toEqual(['https://img1.jpg', 'https://img2.jpg'])
      expect(result.savedUrls).toEqual([])
    }
  })

  it('DashScope 图片完成（来自 b64_image results）', () => {
    const input: DashScopeTaskOutput = {
      results: [{ b64_image: 'base64data1' }, { url: 'https://img1.jpg' }],
    }
    const result = parseProviderOutput(input)
    if (result.type === 'image') {
      expect(result.urls).toEqual(['base64data1', 'https://img1.jpg'])
    }
  })

  it('DashScope image results 过滤非字符串项', () => {
    // DashScopeTaskOutput has index signature, so runtime values may not match declared type
    const input: DashScopeTaskOutput = {
      results: [{ url: 'https://img1.jpg' }, { b64_image: 'data:image/png;base64,abc' }],
      // Simulate non-string entries via index signature (type allows unknown at runtime)
      ...({ results: [{ url: 42 as unknown as string }, { b64_image: null as unknown as string }, { url: 'https://img1.jpg' }] } as Record<string, unknown>),
    }
    const result = parseProviderOutput(input)
    if (result.type === 'image') {
      expect(result.urls).toEqual(['https://img1.jpg'])
    }
  })

  it('DashScope 空 results 数组 → 回退为文本', () => {
    const input: DashScopeTaskOutput = {
      results: [],
    }
    const result = parseProviderOutput(input)
    // empty results → no urls extracted → falls through to taskId/status check → fallback
    expect(result.type).toBe('text')
    expect((result as { type: 'text', text: string }).text).toBe('')
  })

  // ── 6. DashScopeTaskOutput — intermediate state ───────────

  it('DashScope 带 taskId → ProcessingOutputResult', () => {
    const input: DashScopeTaskOutput = {
      taskId: 'async-task-456',
    }
    const result = parseProviderOutput(input)
    expect(result).toEqual({
      type: 'processing',
      taskId: 'async-task-456',
      status: undefined,
    })
  })

  it('DashScope 带 status → ProcessingOutputResult', () => {
    const input: DashScopeTaskOutput = {
      status: 'RUNNING',
    }
    const result = parseProviderOutput(input)
    expect(result.type).toBe('processing')
    if (result.type === 'processing') {
      expect(result.taskId).toBeUndefined()
      expect(result.status).toBe('RUNNING')
    }
  })

  it('DashScope 带 taskId 和 status → ProcessingOutputResult', () => {
    const input: DashScopeTaskOutput = {
      taskId: 'async-task-789',
      status: 'SUCCEEDED',
    }
    const result = parseProviderOutput(input)
    expect(result).toEqual({
      type: 'processing',
      taskId: 'async-task-789',
      status: 'SUCCEEDED',
    })
  })

  // ── 7. Boundary / fallback ────────────────────────────────

  it('undefined 输入 → 回退为空字符串文本', () => {
    const result = parseProviderOutput(undefined)
    expect(result).toEqual({ type: 'text', text: '' })
  })

  it('不可识别对象 → 回退为空字符串文本', () => {
    const result = parseProviderOutput({ random: 'data' } as DashScopeTaskOutput)
    expect(result).toEqual({ type: 'text', text: '' })
  })
})

// ── extractImageUrls ────────────────────────────────────────

describe('extractImageUrls', () => {
  it('image provider output → 返回 urls', () => {
    const input: ImageProviderOutput = {
      type: 'image',
      urls: ['https://a.jpg', 'https://b.jpg'],
      raw: {},
    }
    expect(extractImageUrls(input)).toEqual(['https://a.jpg', 'https://b.jpg'])
  })

  it('DashScope urls 数组 → 仅返回 string 项', () => {
    const input: DashScopeTaskOutput = {
      urls: ['https://a.jpg', 42, 'https://b.jpg', null],
    }
    expect(extractImageUrls(input)).toEqual(['https://a.jpg', 'https://b.jpg'])
  })

  it('undefined → 返回 []', () => {
    expect(extractImageUrls(undefined)).toEqual([])
  })

  it('DashScope 无 urls → 返回 []', () => {
    const input: DashScopeTaskOutput = { taskId: 'some-task' }
    expect(extractImageUrls(input)).toEqual([])
  })
})
