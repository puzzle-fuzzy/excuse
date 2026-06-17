import type { PromptCharacter, PromptLocation, PromptShot } from '../src'
import { describe, expect, it } from 'bun:test'
import { buildShotVideoPrompt } from '../src'

function makeShot(overrides: Partial<PromptShot> = {}): PromptShot {
  return {
    id: 'shot-1',
    shotIndex: 1,
    locationId: 'loc-1',
    characterIds: ['char-1'],
    narrative: 'A girl walks through the forest',
    duration: 5,
    camera: { shotSize: 'medium', angle: 'front', movement: 'slow dolly in', lens: '35mm' },
    continuity: {
      screenDirection: 'left_to_right',
      characterFacing: { 'char-1': 'right' },
      actionStart: 'standing',
      actionEnd: 'walking',
      emotionStart: 'calm',
      emotionEnd: 'determined',
    },
    ...overrides,
  }
}

function makeCharacter(overrides: Partial<PromptCharacter> = {}): PromptCharacter {
  return {
    id: 'char-1',
    name: 'Alice',
    identityPrompt: 'A young woman with long black hair, wearing a red dress',
    negativePrompt: 'blurry, deformed',
    ...overrides,
  }
}

function makeLocation(overrides: Partial<PromptLocation> = {}): PromptLocation {
  return {
    id: 'loc-1',
    name: 'Dark Forest',
    scenePrompt: 'A mysterious dark forest with tall ancient trees',
    negativePrompt: 'bright, sunny',
    cameraRules: {
      axisDirection: 'left_to_right',
      allowedAngles: ['front', 'side'],
      forbiddenAngles: [],
    },
    ...overrides,
  }
}

describe('buildShotVideoPrompt', () => {
  it('包含角色一致性部分', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Character consistency:')
    expect(result.videoPrompt).toContain('Alice')
    expect(result.videoPrompt).toContain('A young woman with long black hair, wearing a red dress')
  })

  it('包含场景一致性部分', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Scene consistency:')
    expect(result.videoPrompt).toContain('A mysterious dark forest with tall ancient trees')
  })

  it('包含叙事描述', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('A girl walks through the forest')
  })

  it('包含镜头参数部分', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Shot size: medium')
    expect(result.videoPrompt).toContain('Angle: front')
    expect(result.videoPrompt).toContain('Movement: slow dolly in')
    expect(result.videoPrompt).toContain('Lens: 35mm')
  })

  it('包含情绪连续性', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Start emotion: calm')
    expect(result.videoPrompt).toContain('End emotion: determined')
  })

  it('包含角色朝向部分', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Alice: facing right')
  })

  it('提供环境信息时包含环境部分', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
      environment: {
        backgroundMotion: 'gentle wind',
        lighting: 'moonlight',
        mood: 'mysterious',
        style: 'cinematic',
      },
    })
    expect(result.videoPrompt).toContain('Background motion: gentle wind')
    expect(result.videoPrompt).toContain('Lighting: moonlight')
    expect(result.videoPrompt).toContain('Mood: mysterious')
    expect(result.videoPrompt).toContain('Style: cinematic')
  })

  it('未提供环境信息时不包含环境部分', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).not.toContain('Background motion:')
  })

  it('提供时间轴时包含 timeline', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
      timeline: [
        { time: '0s-1s', action: 'standing still' },
        { time: '1s-2s', action: 'takes first step' },
      ],
    })
    expect(result.videoPrompt).toContain('Frame-by-frame timeline (total 5s):')
  })

  it('包含质量要求', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('character appearance consistency')
    expect(result.videoPrompt).toContain('180-degree axis')
  })

  // ── 音频段（对话 + 环境音效） ────────────────────────

  it('含对白 narrative → videoPrompt 编排对话音频段', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot({ narrative: 'Alice turns and says "I will not leave you behind"' }),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Audio: dialogue & sound effects')
    // 对白语气对齐 continuity 情绪（calm → determined）
    expect(result.videoPrompt).toContain('Generate the character dialogue exactly as written')
    expect(result.videoPrompt).toContain('calm → determined')
  })

  it('无对白 narrative → videoPrompt 标注 no character dialogue + 环境音效', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot({ narrative: 'A girl walks silently through the forest' }),
      characters: [makeCharacter()],
      location: makeLocation(),
      environment: { backgroundMotion: 'wind in trees', lighting: 'moonlight', mood: 'mysterious', style: 'cinematic' },
    })
    expect(result.videoPrompt).toContain('Audio: dialogue & sound effects')
    expect(result.videoPrompt).toContain('No character dialogue')
    expect(result.videoPrompt).toContain('ambient sound: wind in trees')
  })

  it('hasDialogue 显式传入 true 时即使无引号也编排对话段', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot({ narrative: 'no quotes here', hasDialogue: true }),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Generate the character dialogue exactly as written')
  })

  it('hasDialogue 显式传入 false 时即使 narrative 有引号也判定无对白', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot({ narrative: 'Alice says "hi" but flag overrides', hasDialogue: false }),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('No character dialogue')
  })

  // ── R2V [Image N] 指代 ────────────────────────────────

  it('传入 references → 角色/场景用 [Image N] 指代', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
      references: [
        { targetId: 'char-1', imageNumber: 1 },
        { targetId: 'loc-1', imageNumber: 2 },
      ],
    })
    expect(result.videoPrompt).toContain('Character "Alice" is [Image 1]')
    expect(result.videoPrompt).toContain('Scene is [Image 2]')
  })

  it('references 中未指代的角色仍用文字 identityPrompt', () => {
    const char2: PromptCharacter = { id: 'char-2', name: 'Bob', identityPrompt: 'A tall man', negativePrompt: '' }
    const shot = makeShot({ characterIds: ['char-1', 'char-2'] })
    const result = buildShotVideoPrompt({
      shot,
      characters: [makeCharacter(), char2],
      location: makeLocation(),
      references: [{ targetId: 'char-1', imageNumber: 1 }], // char-2 无图
    })
    expect(result.videoPrompt).toContain('Character "Alice" is [Image 1]')
    expect(result.videoPrompt).toContain('Character "Bob": A tall man')
  })

  it('不传 references → 全程纯文字指代，不含 [Image', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).not.toContain('[Image')
  })

  it('处理多角色', () => {
    const char2: PromptCharacter = {
      id: 'char-2',
      name: 'Bob',
      identityPrompt: 'A tall man with glasses',
      negativePrompt: 'cartoonish',
    }
    const shot = makeShot({ characterIds: ['char-1', 'char-2'] })
    const result = buildShotVideoPrompt({
      shot,
      characters: [makeCharacter(), char2],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Alice')
    expect(result.videoPrompt).toContain('Bob')
  })

  // ── negativePrompt ────────────────────────────────

  it('合并角色和场景的 negative prompts', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.negativePrompt).toContain('blurry, deformed')
    expect(result.negativePrompt).toContain('bright, sunny')
  })

  it('包含默认质量负面提示词', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter({ negativePrompt: '' })],
      location: makeLocation({ negativePrompt: '' }),
    })
    expect(result.negativePrompt).toContain('distorted faces')
    expect(result.negativePrompt).toContain('watermark')
  })

  it('未指定时使用默认 duration 5', () => {
    const shot = makeShot({ duration: 0 })
    const result = buildShotVideoPrompt({
      shot,
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('total 5s')
  })

  it('角色名称缺失时使用 character ID 作为回退名称', () => {
    const shot = makeShot({
      characterIds: ['unknown-id'],
      continuity: {
        screenDirection: 'left_to_right',
        characterFacing: { 'unknown-id': 'left' },
        actionStart: 'standing',
        actionEnd: 'walking',
        emotionStart: 'calm',
        emotionEnd: 'calm',
      },
    })
    const result = buildShotVideoPrompt({
      shot,
      characters: [],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('unknown-id: facing left')
  })
})
