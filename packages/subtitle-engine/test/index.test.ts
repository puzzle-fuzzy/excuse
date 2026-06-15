import { describe, expect, it } from 'bun:test'
import {
  getDefaultStyleConfig,
  getPresetById,
  parseAsrTranscription,
  sentencesToAss,
} from '../src'

describe('@excuse/subtitle-engine', () => {
  it('返回样式预设', () => {
    expect(getDefaultStyleConfig().templateId).toBe('cinema')
    expect(getPresetById('anime')?.config.bold).toBe(true)
    expect(getPresetById('missing')).toBeUndefined()
  })

  it('将句子转换为 ASS 内容', () => {
    const ass = sentencesToAss([
      { id: 's1', text: '你好', beginTime: 1000, endTime: 2500 },
    ], getDefaultStyleConfig(), 1280, 720)

    expect(ass).toContain('PlayResX: 1280')
    expect(ass).toContain('Style: Default,Arial,38')
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,你好')
  })

  it('将 ASR 转录 JSON 解析为可编辑句子', () => {
    const sentences = parseAsrTranscription({
      transcripts: [
        {
          sentences: [
            { text: 'hello', begin_time: 0, end_time: 500, speaker_id: 1 },
            { text: 'world', begin_time: 500, end_time: 900 },
          ],
        },
      ],
    }, (() => {
      let id = 0
      return () => `s${++id}`
    })())

    expect(sentences).toEqual([
      { id: 's1', text: 'hello', beginTime: 0, endTime: 500, speakerId: 1 },
      { id: 's2', text: 'world', beginTime: 500, endTime: 900 },
    ])
  })
})
