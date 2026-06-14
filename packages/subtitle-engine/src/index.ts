export interface SubtitleSentence {
  id: string
  text: string
  beginTime: number
  endTime: number
  speakerId?: number
}

export interface SubtitleStyleConfig {
  templateId: string
  fontSize: number
  fontColor: string
  outlineColor: string
  outlineWidth: number
  position: 'top' | 'center' | 'bottom'
  marginV: number
  bold: boolean
}

export interface SubtitleStylePreset {
  id: string
  name: string
  description: string
  config: SubtitleStyleConfig
}

export const SUBTITLE_STYLE_PRESETS: SubtitleStylePreset[] = [
  {
    id: 'cinema',
    name: '电影经典',
    description: '白字底部居中，细黑描边，经典电影字幕风格',
    config: {
      templateId: 'cinema',
      fontSize: 38,
      fontColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 2,
      position: 'bottom',
      marginV: 30,
      bold: false,
    },
  },
  {
    id: 'anime',
    name: '日漫字幕',
    description: '亮黄字底部居中，黑色描边，日式动漫字幕风格',
    config: {
      templateId: 'anime',
      fontSize: 38,
      fontColor: '#FFFF00',
      outlineColor: '#000000',
      outlineWidth: 2,
      position: 'bottom',
      marginV: 35,
      bold: true,
    },
  },
  {
    id: 'variety',
    name: '综艺弹幕',
    description: '大字底部居中，白色粗描边，综艺节目风格',
    config: {
      templateId: 'variety',
      fontSize: 44,
      fontColor: '#FFFFFF',
      outlineColor: '#333333',
      outlineWidth: 3,
      position: 'bottom',
      marginV: 25,
      bold: true,
    },
  },
  {
    id: 'korean',
    name: '韩剧粉字',
    description: '粉色字底部居中，白色描边，韩剧字幕风格',
    config: {
      templateId: 'korean',
      fontSize: 36,
      fontColor: '#FFB6C1',
      outlineColor: '#FFFFFF',
      outlineWidth: 2,
      position: 'bottom',
      marginV: 30,
      bold: false,
    },
  },
  {
    id: 'vlog',
    name: '短视频Vlog',
    description: '大字底部居中，半透明底框，Vlog短视频风格',
    config: {
      templateId: 'vlog',
      fontSize: 42,
      fontColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 1,
      position: 'bottom',
      marginV: 20,
      bold: false,
    },
  },
  {
    id: 'documentary',
    name: '纪录片',
    description: '细字底部偏左，无描边，纪录片风格',
    config: {
      templateId: 'documentary',
      fontSize: 32,
      fontColor: '#CCCCCC',
      outlineColor: '#000000',
      outlineWidth: 0,
      position: 'bottom',
      marginV: 40,
      bold: false,
    },
  },
]

export function getDefaultStyleConfig(): SubtitleStyleConfig {
  return SUBTITLE_STYLE_PRESETS[0]!.config
}

export function getPresetById(id: string): SubtitleStylePreset | undefined {
  return SUBTITLE_STYLE_PRESETS.find(preset => preset.id === id)
}

export function sentencesToAss(
  sentences: SubtitleSentence[],
  styleConfig: SubtitleStyleConfig,
  videoWidth: number = 1920,
  videoHeight: number = 1080,
): string {
  const { fontSize, fontColor, outlineColor, outlineWidth, position, marginV, bold } = styleConfig

  const assFontColor = hexToAssColor(fontColor)
  const assOutlineColor = hexToAssColor(outlineColor)
  const assAlignment = position === 'top' ? 8 : position === 'center' ? 5 : 2

  const lines = sentences.map((sentence) => {
    const start = msToAssTime(sentence.beginTime)
    const end = msToAssTime(sentence.endTime)
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${sentence.text}`
  })

  return `[Script Info]
Title: Subtitle
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},${assFontColor},&H000000FF,${assOutlineColor},&H00000000,${bold ? -1 : 0},0,0,0,100,100,0,0,1,${outlineWidth},0,${assAlignment},10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`
}

export function parseAsrTranscription(rawJson: unknown, createId: () => string = () => crypto.randomUUID()): SubtitleSentence[] {
  if (!rawJson || typeof rawJson !== 'object')
    return []

  const root = rawJson as Record<string, unknown>
  const transcripts = root.transcripts as Array<Record<string, unknown>> | undefined

  if (!transcripts || !Array.isArray(transcripts))
    return []

  const sentences: SubtitleSentence[] = []
  for (const transcript of transcripts) {
    const rawSentences = transcript.sentences as Array<Record<string, unknown>> | undefined
    if (!rawSentences || !Array.isArray(rawSentences))
      continue

    for (const sentence of rawSentences) {
      sentences.push({
        id: createId(),
        text: typeof sentence.text === 'string' ? sentence.text : '',
        beginTime: typeof sentence.begin_time === 'number' ? sentence.begin_time : 0,
        endTime: typeof sentence.end_time === 'number' ? sentence.end_time : 0,
        ...(typeof sentence.speaker_id === 'number' && { speakerId: sentence.speaker_id }),
      })
    }
  }

  return sentences
}

function hexToAssColor(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `&H00${b.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${r.toString(16).padStart(2, '0')}`
}

function msToAssTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const centiseconds = Math.floor((ms % 1000) / 10)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`
}
