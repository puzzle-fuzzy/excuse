import { describe, expect, it } from 'bun:test'
import {
  getDefaultStyleConfig,
  getPresetById,
  parseAsrTranscription,
  sentencesToAss,
} from '../src'

describe('@excuse/subtitle-engine', () => {
  it('returns style presets', () => {
    expect(getDefaultStyleConfig().templateId).toBe('cinema')
    expect(getPresetById('anime')?.config.bold).toBe(true)
    expect(getPresetById('missing')).toBeUndefined()
  })

  it('converts sentences to ASS content', () => {
    const ass = sentencesToAss([
      { id: 's1', text: '你好', beginTime: 1000, endTime: 2500 },
    ], getDefaultStyleConfig(), 1280, 720)

    expect(ass).toContain('PlayResX: 1280')
    expect(ass).toContain('Style: Default,Arial,38')
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,你好')
  })

  it('parses ASR transcript JSON into editable sentences', () => {
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
