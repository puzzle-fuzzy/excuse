/**
 * 视频提示词构建器
 *
 * 将镜头数据（角色、场景、摄影、连续性、时间线、环境）组装成
 * 可直接传给 AI 视频生成模型的 videoPrompt 和 negativePrompt。
 *
 * 输出结构：
 *   - videoPrompt: 包含角色一致性、场景、叙事、逐帧时间线、情绪、朝向、环境、摄影参数
 *   - negativePrompt: 合并角色 + 场景负面提示词 + 通用质量约束
 */
export interface PromptShot {
  id: string
  shotIndex: number
  locationId: string | null
  characterIds: string[]
  narrative: string
  duration: number
  camera: {
    shotSize: string
    angle: string
    movement: string
    lens: string
  }
  continuity: {
    screenDirection: string
    characterFacing: Record<string, string>
    actionStart: string
    actionEnd: string
    emotionStart: string
    emotionEnd: string
  }
  timeline?: Array<{ time: string, action: string }>
  environment?: PromptEnvironment
  /**
   * narrative 是否含角色对白（由调用方用 `hasDialogueAudio(narrative)` 预判传入）。
   * 缺省时 builder 自己用引号启发式兜底判定。决定是否编排「对话音频」段。
   */
  hasDialogue?: boolean
}

export interface PromptCharacter {
  id: string
  name: string
  identityPrompt: string
  negativePrompt: string
}

export interface PromptLocation {
  id: string
  name: string
  scenePrompt: string
  negativePrompt: string
  cameraRules?: {
    axisDirection: string
    allowedAngles: string[]
    forbiddenAngles: string[]
  }
}

export interface PromptEnvironment {
  backgroundMotion?: string
  lighting?: string
  mood?: string
  style?: string
}

/** 解析时间范围字符串 "0s-5s" → { start: 0, end: 5 } */
function parseTimeRange(timeRange: string): { start: number, end: number } {
  const match = timeRange.match(/(\d+)s-(\d+)s/)
  if (!match)
    return { start: 0, end: 5 }
  const [, start = '0', end = '5'] = match
  return { start: Number.parseInt(start), end: Number.parseInt(end) }
}

/** 将多秒区间时间线展开为逐秒时间线，如 "0s-3s: 动作A" → 3 条单秒条目 */
function expandTimelineToPerSecond(timeline: Array<{ time: string, action: string }>): Array<{ time: string, action: string }> {
  const perSecond: Array<{ time: string, action: string }> = []

  for (const entry of timeline) {
    const { start, end } = parseTimeRange(entry.time)
    for (let second = start; second < end; second++) {
      perSecond.push({
        time: `${second}s-${second + 1}s`,
        action: entry.action,
      })
    }
  }

  return perSecond
}

/**
 * 构建逐帧时间线文本段落
 *
 * 优先使用 LLM 生成的 timeline 数据（展开为逐秒后合并连续相同动作），
 * 若无 timeline 则根据 actionStart/actionEnd 生成均匀分布的 fallback 时间线。
 */
function buildTimelineSection(
  timeline: Array<{ time: string, action: string }>,
  actionStart: string,
  actionEnd: string,
  duration: number,
): string {
  if (timeline && timeline.length > 0) {
    const perSecondTimeline = expandTimelineToPerSecond(timeline)
    const sections: string[] = []
    let currentAction = perSecondTimeline[0]?.action || ''
    let startTime = 0
    let endTime = 0

    for (let i = 0; i < perSecondTimeline.length; i++) {
      const entry = perSecondTimeline[i]
      if (!entry)
        continue
      if (entry.action !== currentAction || i === perSecondTimeline.length - 1) {
        if (currentAction) {
          if (startTime === endTime) {
            sections.push(`  ${startTime}s-${startTime + 1}s: ${currentAction}`)
          }
          else {
            sections.push(`  ${startTime}s-${endTime + 1}s: ${currentAction}`)
          }
        }
        currentAction = entry.action
        startTime = Number.parseInt(entry.time.split('-')[0] ?? '0')
        endTime = startTime
      }
      else {
        endTime = Number.parseInt(entry.time.split('-')[0] ?? '0')
      }
    }

    return sections.join('\n')
  }

  const fallback: string[] = []
  const totalSeconds = Math.floor(duration)

  for (let second = 0; second < totalSeconds; second++) {
    const action = second === totalSeconds - 1 ? actionEnd : actionStart
    fallback.push(`  ${second}s-${second + 1}s: ${action}`)
  }

  return fallback.join('\n')
}

/** 引号启发式：narrative 是否含角色对白（兜底判定，调用方可经 shot.hasDialogue 显式传入） */
function narrativeHasDialogue(narrative: string): boolean {
  return /["“”‘’「」『』]/u.test(narrative)
}

/**
 * 构建「音频」段 — 指示 HappyHorse 原生生成镜头内对白音频 + 环境音效。
 *
 * - 有对白：复用 narrative 里已编排的对白（中文引号包裹），用 continuity 情绪标注语气，
 *   要求模型生成与对白文本一致的语音。
 * - 无对白：明确 `no character dialogue`，仅描述环境音效。
 * - 环境音效：从 environment（backgroundMotion/lighting/mood）派生 ambient sound 描述。
 *
 * 该段紧跟在 Current shot 之后，引导模型把「画面 + 声音」一并生成（HappyHorse 原生音视频）。
 */
function buildAudioSection(
  shot: PromptShot,
  environment: PromptEnvironment | undefined,
): string {
  const hasDialogue = shot.hasDialogue ?? narrativeHasDialogue(shot.narrative)

  const ambientSound = environment?.backgroundMotion
    ? `ambient sound: ${environment.backgroundMotion.toLowerCase()}`
    : 'ambient sound: subtle environmental ambience'

  const dialogueLine = hasDialogue
    ? `- Generate the character dialogue exactly as written in the shot description above (text in quotes), with voice tone matching the scene emotion (${shot.continuity.emotionStart || 'neutral'} → ${shot.continuity.emotionEnd || 'neutral'}).`
    : '- No character dialogue in this shot (ambient only).'

  return `Audio: dialogue & sound effects:
${dialogueLine}
- ${ambientSound}
- Sync all sound to the on-screen action and timeline below.
`
}

/**
 * 为单个镜头构建完整的视频生成提示词
 *
 * 组装内容：
 *   1. Character consistency — 角色 identityPrompt（保证外貌一致）
 *   2. Scene consistency — 场景 scenePrompt（保证环境一致）
 *   3. Current shot — 镜头叙事描述
 *   4. Audio — 对白音频 + 环境音效（HappyHorse 原生音视频）
 *   5. Frame-by-frame timeline — 逐秒动作时间线
 *   6. Emotion continuity — 起始/结束情绪
 *   7. Character facing — 角色朝向（遵守 180 度规则）
 *   8. Environment — 光线/氛围/风格/背景动态
 *   9. Camera — shotSize/angle/movement/lens
 *   10. Quality requirements — 高一致性 AI 视频的硬性约束
 */
export function buildShotVideoPrompt(args: {
  shot: PromptShot
  characters: PromptCharacter[]
  location: PromptLocation
  timeline?: Array<{ time: string, action: string }>
  environment?: PromptEnvironment
}): { videoPrompt: string, negativePrompt: string } {
  const { shot, characters, location, timeline, environment } = args

  const idToName = new Map(characters.map(c => [c.id, c.name]))

  const characterSection = characters
    .map(c => `Character "${c.name}": ${c.identityPrompt}`)
    .join('\n')

  const facingEntries = Object.entries(shot.continuity.characterFacing)
  const facingSection = facingEntries
    .map(([idOrName, dir]) => {
      const name = idToName.get(idOrName) || idOrName
      return `  ${name}: facing ${dir}`
    })
    .join('\n')

  const duration = shot.duration || 5
  const timelineSection = buildTimelineSection(
    timeline || [],
    shot.continuity.actionStart,
    shot.continuity.actionEnd,
    duration,
  )

  const environmentSection = environment
    ? `Background motion: ${environment.backgroundMotion || 'static'}
Lighting: ${environment.lighting || 'natural'}
Mood: ${environment.mood || 'neutral'}
Style: ${environment.style || 'cinematic'}`
    : ''

  const cameraSection = [
    `Shot size: ${shot.camera.shotSize}`,
    `Angle: ${shot.camera.angle}`,
    `Movement: ${shot.camera.movement}`,
    `Lens: ${shot.camera.lens}`,
  ].join(', ')

  const audioSection = buildAudioSection(shot, environment)

  const videoPrompt = `Character consistency:
${characterSection}

Scene consistency:
${location.scenePrompt}

Current shot:
${shot.narrative}

${audioSection}Frame-by-frame timeline (total ${duration}s):
${timelineSection}

Emotion continuity:
  Start emotion: ${shot.continuity.emotionStart}
  End emotion: ${shot.continuity.emotionEnd}

Character facing:
${facingSection}

${environmentSection ? `Environment:\n${environmentSection}\n` : ''}Camera:
${cameraSection}

Important requirements for high-coherence AI video:
- Each second must have explicit, meaningful action
- No static frames - continuous motion required
- Smooth transitions between consecutive seconds
- Maintain character appearance consistency across all frames
- Maintain costume and hairstyle consistency
- Keep scene structure and lighting consistent
- Do not cross the 180-degree axis
- Do not suddenly change character facing direction
- Do not suddenly change lighting or mood
- Do not introduce new characters mid-shot
- Natural, realistic human movements
- Cinematic quality with professional framing`

  const charNegatives = characters
    .map(c => c.negativePrompt || '')
    .filter(Boolean)
    .join(', ')

  const negativePrompt = [
    charNegatives,
    location.negativePrompt || '',
    'blurry, low quality, distorted faces, extra limbs, watermark, text overlay, motion blur, camera shake, static pose, frozen frame, sudden movement changes',
  ]
    .filter(Boolean)
    .join(', ')

  return { videoPrompt, negativePrompt }
}
