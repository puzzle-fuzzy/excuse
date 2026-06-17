/**
 * BGM Prompt 构建 — Phase 10
 *
 * 输入：项目故事摘要 + 主导情绪（从镜头 environment.mood 聚合）
 * 输出：FunMusic (fun-music-v1) 可用的音乐描述 prompt（1~2000 字符）
 *
 * FunMusic prompt 是「风格 + 情绪 + 乐器 + 场景」的自然语言音乐描述，
 * 模型据此自动创作并生成歌曲。不是叙事文本，需转译为音乐语言。
 */

export interface BgmPromptInput {
  /** 项目故事摘要（来自 NovelAnalysis.summary 或 storyText 截断） */
  storySummary: string
  /** 主导情绪（紧张/温馨/悲伤/激昂/悬疑 等），可空 */
  mood?: string | null
  /** 音乐风格偏好（民谣/电子/管弦/古风 等），可空 — 缺省由情绪推断 */
  genre?: string | null
}

/** 情绪 → 音乐风格/配器映射，让 BGM 与叙事基调一致 */
const MOOD_TO_MUSIC: Record<string, { style: string, instruments: string, tempo: string }> = {
  紧张: { style: '紧张悬疑的影视配乐', instruments: '弦乐顿弓、定音鼓、低频脉冲', tempo: '急促不规则的节奏' },
  悬疑: { style: '悬疑暗黑的氛围配乐', instruments: '低频合成器、钢琴单音、细密弦乐', tempo: '缓慢铺陈、间歇停顿' },
  温馨: { style: '温暖治愈的民谣配乐', instruments: '木吉他、钢琴、轻柔弦乐', tempo: '舒缓平稳的节奏' },
  悲伤: { style: '哀伤抒情的管弦配乐', instruments: '大提琴、钢琴、哀婉弦乐', tempo: '缓慢沉稳的节奏' },
  激昂: { style: '激昂史诗的管弦配乐', instruments: '铜管、定音鼓、宏大弦乐群', tempo: '强劲有力的进行节奏' },
  欢快: { style: '轻快活泼的流行配乐', instruments: '尤克里里、轻打击乐、合成器', tempo: '明快跳跃的节奏' },
  浪漫: { style: '浪漫柔美的钢琴配乐', instruments: '钢琴、弦乐、竖琴', tempo: '舒缓流动的节奏' },
}

/** 情绪关键词模糊匹配 — 取首个命中的映射，未命中回退通用氛围 */
function resolveMoodMusic(mood: string | null | undefined) {
  if (!mood)
    return null
  for (const [key, spec] of Object.entries(MOOD_TO_MUSIC)) {
    if (mood.includes(key))
      return spec
  }
  return null
}

/**
 * 构建 FunMusic 音乐描述 prompt
 *
 * 结构：风格基调 → 配器 → 节奏 → 情绪/场景叙事（用音乐语言重述，非剧情复述）。
 * 控制在 2000 字符内（FunMusic 非流式上限）。
 */
export function buildBgmPrompt(input: BgmPromptInput): string {
  const moodMusic = resolveMoodMusic(input.mood)

  if (input.genre) {
    // 用户显式指定风格时优先采用，但仍叠加情绪基调
    return [
      `${input.genre}风格的电影背景音乐`,
      moodMusic ? `情绪基调${input.mood ?? '柔和'}，${moodMusic.tempo}` : '情绪基调柔和，舒缓平稳的节奏',
      `适合作为以下场景的背景音乐：${truncate(input.storySummary, 600)}`,
    ].join('，')
  }

  if (moodMusic) {
    return [
      moodMusic.style,
      `配器以${moodMusic.instruments}为主`,
      moodMusic.tempo,
      `适合作为以下场景的背景音乐：${truncate(input.storySummary, 600)}`,
    ].join('，')
  }

  // 缺省：中性氛围配乐
  return `舒缓柔和的电影氛围背景音乐，以钢琴与轻柔弦乐为主，平稳流动的节奏，适合作为以下场景的背景音乐：${truncate(input.storySummary, 800)}`
}

/** 截断到指定字符数并补省略号 */
function truncate(text: string, max: number): string {
  if (text.length <= max)
    return text
  return `${text.slice(0, max - 1)}…`
}
