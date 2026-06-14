import type { SubtitleSentence, SubtitleStyleConfig } from '@excuse/db'
import { describe, expect, it } from 'bun:test'
import { getDefaultStyleConfig, getPresetById, sentencesToAss, SUBTITLE_STYLE_PRESETS } from '../src/subtitle'

// ===== sentencesToAss =====

describe('sentencesToAss', () => {
  const defaultStyle: SubtitleStyleConfig = {
    templateId: 'cinema',
    fontSize: 24,
    fontColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    position: 'bottom',
    marginV: 30,
    bold: false,
  }

  const sentences: SubtitleSentence[] = [
    { id: 's1', text: '你好世界', beginTime: 0, endTime: 2000 },
    { id: 's2', text: '欢迎来到这里', beginTime: 2000, endTime: 5000 },
    { id: 's3', text: '再见', beginTime: 5000, endTime: 7000, speakerId: 1 },
  ]

  it('生成 ASS 格式字幕内容', () => {
    const result = sentencesToAss(sentences, defaultStyle)

    expect(result).toContain('[Script Info]')
    expect(result).toContain('ScriptType: v4.00+')
    expect(result).toContain('PlayResX: 1920')
    expect(result).toContain('PlayResY: 1080')
    expect(result).toContain('[V4+ Styles]')
    expect(result).toContain('[Events]')
  })

  it('包含正确的样式行', () => {
    const result = sentencesToAss(sentences, defaultStyle)

    // 白色 → ASS BGR: &H00ffffff (hex output is lowercase)
    expect(result).toContain('Style: Default,Arial,24,&H00ffffff')
    // 黑色描边 → BGR: &H00000000
    expect(result).toContain('&H00000000')
    // bold=false → Bold=0, italic=0, underline=0, strikeout=0
    // Format: Bold,Italic,Underline,StrikeOut,...
    expect(result).toContain('0,0,0,0,100,100,0,0,1,2,0,2,10,10,30,1')
  })

  it('加粗样式', () => {
    const boldStyle: SubtitleStyleConfig = {
      ...defaultStyle,
      bold: true,
    }
    const result = sentencesToAss(sentences, boldStyle)

    // ASS bold: -1 = true, 0 = false — hex output is lowercase
    expect(result).toContain('-1,0,0,0,100,100,0,0,1,2,0,2,10,10,30,1')
  })

  it('包含正确的对话行', () => {
    const result = sentencesToAss(sentences, defaultStyle)

    expect(result).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,你好世界')
    expect(result).toContain('Dialogue: 0,0:00:02.00,0:00:05.00,Default,,0,0,0,,欢迎来到这里')
    expect(result).toContain('Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,再见')
  })

  it('顶部位置使用 alignment=8', () => {
    const topStyle: SubtitleStyleConfig = {
      ...defaultStyle,
      position: 'top',
    }
    const result = sentencesToAss(sentences, topStyle)

    expect(result).toContain(',8,10,10,30,1')
  })

  it('居中位置使用 alignment=5', () => {
    const centerStyle: SubtitleStyleConfig = {
      ...defaultStyle,
      position: 'center',
    }
    const result = sentencesToAss(sentences, centerStyle)

    expect(result).toContain(',5,10,10,30,1')
  })

  it('自定义分辨率', () => {
    const result = sentencesToAss(sentences, defaultStyle, 1280, 720)

    expect(result).toContain('PlayResX: 1280')
    expect(result).toContain('PlayResY: 720')
  })

  it('HEX 颜色转换为 ASS BGR 格式', () => {
    // #FFB6C1 (韩剧粉) → R=FF, G=B6, B=C1 → BGR: &H00C1B6FF
    const pinkStyle: SubtitleStyleConfig = {
      ...defaultStyle,
      fontColor: '#FFB6C1',
      outlineColor: '#FFFFFF',
    }
    const result = sentencesToAss(sentences, pinkStyle)

    expect(result).toContain('&H00c1b6ff') // fontColor BGR (lowercase)
    expect(result).toContain('&H00ffffff') // outlineColor BGR (white, lowercase)
  })

  it('描边宽度为 0 时正确处理', () => {
    const noOutline: SubtitleStyleConfig = {
      ...defaultStyle,
      outlineWidth: 0,
    }
    const result = sentencesToAss(sentences, noOutline)

    // Outline=0 in ASS format: BorderStyle=1, Outline=0, Shadow=0, Alignment=2
    expect(result).toContain('1,0,0,2,10,10,30,1')
  })

  it('空句子列表生成不含对话行', () => {
    const result = sentencesToAss([], defaultStyle)

    expect(result).toContain('[Script Info]')
    expect(result).toContain('[Events]')
    expect(result).not.toContain('Dialogue:')
  })

  it('毫秒转 ASS 时间格式', () => {
    // 3661500ms = 1:01:01.50
    const longSentences: SubtitleSentence[] = [
      { id: 's1', text: '长时间', beginTime: 3661500, endTime: 3672500 },
    ]
    const result = sentencesToAss(longSentences, defaultStyle)

    expect(result).toContain('Dialogue: 0,1:01:01.50,1:01:12.50')
  })
})

// ===== hexToAssColor (通过 sentencesToAss 间接测试) =====

describe('ASS 颜色转换', () => {
  it('纯黑 #000000 → &H00000000', () => {
    const style: SubtitleStyleConfig = {
      templateId: 'test',
      fontSize: 24,
      fontColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 2,
      position: 'bottom',
      marginV: 30,
      bold: false,
    }
    const result = sentencesToAss(
      [{ id: 's1', text: 'a', beginTime: 0, endTime: 100 }],
      style,
    )
    expect(result).toContain('&H00000000')
  })

  it('纯红 #FF0000 → &H000000ff (BGR, lowercase)', () => {
    const style: SubtitleStyleConfig = {
      templateId: 'test',
      fontSize: 24,
      fontColor: '#FF0000',
      outlineColor: '#000000',
      outlineWidth: 0,
      position: 'bottom',
      marginV: 30,
      bold: false,
    }
    const result = sentencesToAss(
      [{ id: 's1', text: 'a', beginTime: 0, endTime: 100 }],
      style,
    )
    expect(result).toContain('&H000000ff')
  })

  it('纯蓝 #0000FF → &H00ff0000 (BGR, lowercase)', () => {
    const style: SubtitleStyleConfig = {
      templateId: 'test',
      fontSize: 24,
      fontColor: '#0000FF',
      outlineColor: '#000000',
      outlineWidth: 0,
      position: 'bottom',
      marginV: 30,
      bold: false,
    }
    const result = sentencesToAss(
      [{ id: 's1', text: 'a', beginTime: 0, endTime: 100 }],
      style,
    )
    expect(result).toContain('&H00ff0000')
  })

  it('黄色 #FFFF00 → &H0000ffff (BGR, lowercase)', () => {
    const style: SubtitleStyleConfig = {
      templateId: 'test',
      fontSize: 24,
      fontColor: '#FFFF00',
      outlineColor: '#000000',
      outlineWidth: 0,
      position: 'bottom',
      marginV: 30,
      bold: false,
    }
    const result = sentencesToAss(
      [{ id: 's1', text: 'a', beginTime: 0, endTime: 100 }],
      style,
    )
    expect(result).toContain('&H0000ffff')
  })
})

// ===== Subtitle Style Presets =====

describe('SUBTITLE_STYLE_PRESETS', () => {
  it('包含 6 个预设', () => {
    expect(SUBTITLE_STYLE_PRESETS).toHaveLength(6)
  })

  it('每个预设都有 id、name、description、config', () => {
    for (const preset of SUBTITLE_STYLE_PRESETS) {
      expect(preset.id).toBeTruthy()
      expect(preset.name).toBeTruthy()
      expect(preset.description).toBeTruthy()
      expect(preset.config).toBeDefined()
      expect(preset.config.templateId).toBe(preset.id)
      expect(typeof preset.config.fontSize).toBe('number')
      expect(typeof preset.config.fontColor).toBe('string')
      expect(typeof preset.config.outlineColor).toBe('string')
      expect(typeof preset.config.outlineWidth).toBe('number')
      expect(['top', 'center', 'bottom']).toContain(preset.config.position)
      expect(typeof preset.config.marginV).toBe('number')
      expect(typeof preset.config.bold).toBe('boolean')
    }
  })

  it('cinema 预设是白字黑描边底部居中', () => {
    const cinema = getPresetById('cinema')
    expect(cinema).toBeDefined()
    expect(cinema!.config.fontColor).toBe('#FFFFFF')
    expect(cinema!.config.outlineColor).toBe('#000000')
    expect(cinema!.config.position).toBe('bottom')
    expect(cinema!.config.bold).toBe(false)
  })

  it('anime 预设是黄字黑描边加粗', () => {
    const anime = getPresetById('anime')
    expect(anime).toBeDefined()
    expect(anime!.config.fontColor).toBe('#FFFF00')
    expect(anime!.config.outlineColor).toBe('#000000')
    expect(anime!.config.bold).toBe(true)
  })
})

describe('getDefaultStyleConfig', () => {
  it('返回 cinema 预设的 config', () => {
    const config = getDefaultStyleConfig()
    expect(config.templateId).toBe('cinema')
    expect(config.fontSize).toBe(38)
    expect(config.fontColor).toBe('#FFFFFF')
    expect(config.outlineColor).toBe('#000000')
  })
})

describe('getPresetById', () => {
  it('返回匹配的预设', () => {
    expect(getPresetById('vlog')?.name).toBe('短视频Vlog')
    expect(getPresetById('documentary')?.name).toBe('纪录片')
  })

  it('不存在的预设返回 undefined', () => {
    expect(getPresetById('nonexistent')).toBeUndefined()
  })
})
