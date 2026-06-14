import { describe, expect, it } from 'bun:test'
import type { DashScopeTaskOutput, ImageProviderOutput, TextProviderOutput, VideoTaskProviderOutput } from '@excuse/provider'
import { extractImageUrls, parseProviderOutput } from '../src/modules/generation/output-parser'

describe('parseProviderOutput', () => {
  // ── 1. TextProviderOutput ────────────────────────────────

  it('text provider output → TextOutputResult', () => {
    const input: TextProviderOutput = {
      type: 'text',
      text: 'Hello world',
      raw: { some: 'raw' },
    }
    const result = parseProviderOutput(input)
    expect(result).toEqual({ type: 'text', text: 'Hello world' })
  })

  // ── 2. ImageProviderOutput ────────────────────────────────

  it('image provider output → ImageOutputResult', () => {
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

  it('processing provider output → ProcessingOutputResult', () => {
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

  it('DashScope video completed → VideoOutputResult', () => {
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

  it('DashScope video completed with savedUrls filters non-string', () => {
    const input: DashScopeTaskOutput = {
      video_url: 'https://video.mp4',
      savedUrls: ['https://saved1.jpg', 42, null, 'https://saved2.jpg'],
    }
    const result = parseProviderOutput(input)
    if (result.type === 'video') {
      expect(result.savedUrls).toEqual(['https://saved1.jpg', 'https://saved2.jpg'])
    }
  })

  it('DashScope video completed with string originalUrl preserved', () => {
    const input: DashScopeTaskOutput = {
      video_url: 'https://video.mp4',
      originalUrl: 'https://original.mp4',
    }
    const result = parseProviderOutput(input)
    if (result.type === 'video') {
      expect(result.originalUrl).toBe('https://original.mp4')
    }
  })

  it('DashScope video completed with non-string originalUrl dropped', () => {
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

  it('DashScope image completed from url results', () => {
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

  it('DashScope image completed from b64_image results', () => {
    const input: DashScopeTaskOutput = {
      results: [{ b64_image: 'base64data1' }, { url: 'https://img1.jpg' }],
    }
    const result = parseProviderOutput(input)
    if (result.type === 'image') {
      expect(result.urls).toEqual(['base64data1', 'https://img1.jpg'])
    }
  })

  it('DashScope image results filters non-string items', () => {
    const input: DashScopeTaskOutput = {
      results: [{ url: 42 }, { b64_image: null }, { url: 'https://img1.jpg' }],
    }
    const result = parseProviderOutput(input)
    if (result.type === 'image') {
      expect(result.urls).toEqual(['https://img1.jpg'])
    }
  })

  it('DashScope empty results array → fallback text', () => {
    const input: DashScopeTaskOutput = {
      results: [],
    }
    const result = parseProviderOutput(input)
    // empty results → no urls extracted → falls through to taskId/status check → fallback
    expect(result.type).toBe('text')
    expect((result as { type: 'text', text: string }).text).toBe('')
  })

  // ── 6. DashScopeTaskOutput — intermediate state ───────────

  it('DashScope with taskId → ProcessingOutputResult', () => {
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

  it('DashScope with status → ProcessingOutputResult', () => {
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

  it('DashScope with taskId and status → ProcessingOutputResult', () => {
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

  it('undefined input → fallback text with empty string', () => {
    const result = parseProviderOutput(undefined)
    expect(result).toEqual({ type: 'text', text: '' })
  })

  it('unrecognizable object → fallback text with empty string', () => {
    const result = parseProviderOutput({ random: 'data' } as DashScopeTaskOutput)
    expect(result).toEqual({ type: 'text', text: '' })
  })
})

// ── extractImageUrls ────────────────────────────────────────

describe('extractImageUrls', () => {
  it('image provider output → returns urls', () => {
    const input: ImageProviderOutput = {
      type: 'image',
      urls: ['https://a.jpg', 'https://b.jpg'],
      raw: {},
    }
    expect(extractImageUrls(input)).toEqual(['https://a.jpg', 'https://b.jpg'])
  })

  it('DashScope urls array → returns string items only', () => {
    const input: DashScopeTaskOutput = {
      urls: ['https://a.jpg', 42, 'https://b.jpg', null],
    }
    expect(extractImageUrls(input)).toEqual(['https://a.jpg', 'https://b.jpg'])
  })

  it('undefined → returns []', () => {
    expect(extractImageUrls(undefined)).toEqual([])
  })

  it('DashScope without urls → returns []', () => {
    const input: DashScopeTaskOutput = { taskId: 'some-task' }
    expect(extractImageUrls(input)).toEqual([])
  })
})
