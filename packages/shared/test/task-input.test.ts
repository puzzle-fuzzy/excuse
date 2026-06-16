import { describe, expect, it } from 'bun:test'
import {
  parseGenerationInputParamsMeta,
  parseMediaBurnSubtitleInput,
  parseMediaExtractAudioInput,
} from '../src/task-input'

describe('parseMediaExtractAudioInput', () => {
  it('合法输入 → ok', () => {
    const r = parseMediaExtractAudioInput({ videoFileId: 'f-1', projectId: 'p-1' })
    expect(r.ok).toBe(true)
    if (r.ok)
      expect(r.input).toEqual({ videoFileId: 'f-1', projectId: 'p-1' })
  })

  it('缺 videoFileId → 失败', () => {
    const r = parseMediaExtractAudioInput({ projectId: 'p-1' })
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toContain('videoFileId')
  })

  it('缺 projectId → 失败', () => {
    const r = parseMediaExtractAudioInput({ videoFileId: 'f-1' })
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toContain('projectId')
  })

  it('类型错（videoFileId 非字符串）→ 失败', () => {
    const r = parseMediaExtractAudioInput({ videoFileId: 123, projectId: 'p-1' })
    expect(r.ok).toBe(false)
  })

  it('null / 数组 → 失败', () => {
    expect(parseMediaExtractAudioInput(null).ok).toBe(false)
    expect(parseMediaExtractAudioInput([1, 2]).ok).toBe(false)
  })

  it('多余字段透传不报错', () => {
    const r = parseMediaExtractAudioInput({ videoFileId: 'f-1', projectId: 'p-1', extra: 'x' })
    expect(r.ok).toBe(true)
  })
})

describe('parseMediaBurnSubtitleInput', () => {
  it('合法输入 → ok', () => {
    const r = parseMediaBurnSubtitleInput({ exportRecordId: 'e-1' })
    expect(r.ok).toBe(true)
    if (r.ok)
      expect(r.input.exportRecordId).toBe('e-1')
  })

  it('缺 exportRecordId → 失败', () => {
    const r = parseMediaBurnSubtitleInput({})
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toContain('exportRecordId')
  })

  it('类型错 → 失败', () => {
    const r = parseMediaBurnSubtitleInput({ exportRecordId: true })
    expect(r.ok).toBe(false)
  })
})

describe('parseGenerationInputParamsMeta', () => {
  it('提取 source/projectId/shotId 字符串字段', () => {
    const meta = parseGenerationInputParamsMeta({
      source: 'canvas',
      projectId: 'p-1',
      shotId: 's-1',
      requestedModel: 'gpt-4o',
      referenceFileIds: ['a', 'b'],
      prompt: 'hello',
      duration: 5,
    })
    expect(meta).toEqual({
      source: 'canvas',
      projectId: 'p-1',
      shotId: 's-1',
      requestedModel: 'gpt-4o',
      referenceFileIds: ['a', 'b'],
    })
  })

  it('source 非法值 → 不保留 source', () => {
    const meta = parseGenerationInputParamsMeta({ source: 'unknown-source' })
    expect(meta.source).toBeUndefined()
  })

  it('projectId/shotId 非字符串 → 不保留', () => {
    const meta = parseGenerationInputParamsMeta({ projectId: 123, shotId: null })
    expect(meta.projectId).toBeUndefined()
    expect(meta.shotId).toBeUndefined()
  })

  it('referenceFileIds 非字符串数组 → 不保留', () => {
    const meta = parseGenerationInputParamsMeta({ referenceFileIds: ['a', 2] })
    expect(meta.referenceFileIds).toBeUndefined()
  })

  it('null / 非 object → 返回空对象', () => {
    expect(parseGenerationInputParamsMeta(null)).toEqual({})
    expect(parseGenerationInputParamsMeta('str')).toEqual({})
    expect(parseGenerationInputParamsMeta([1])).toEqual({})
  })

  it('只校验元字段，模型参数不进 meta', () => {
    const meta = parseGenerationInputParamsMeta({ prompt: 'hi', duration: 5 })
    expect(meta).toEqual({})
  })
})
