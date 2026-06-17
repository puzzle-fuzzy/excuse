import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from '@excuse/canvas-engine'
import { buildShotVideoPrompt } from '@excuse/prompt-engine'
import { describe, expect, it } from 'bun:test'

function makeShot(overrides: Partial<NormalizedShot> = {}): NormalizedShot {
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

function makeCharacter(overrides: Partial<NormalizedCharacter> = {}): NormalizedCharacter {
  return {
    id: 'char-1',
    name: 'Alice',
    identityPrompt: 'A young woman with long black hair, wearing a red dress',
    negativePrompt: 'blurry, deformed',
    ...overrides,
  }
}

function makeLocation(overrides: Partial<NormalizedLocation> = {}): NormalizedLocation {
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

  it('包含叙述内容', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('A girl walks through the forest')
  })

  it('包含摄像机部分', () => {
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

  it('包含情绪连贯性', () => {
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

  it('省略环境信息时不包含环境部分', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).not.toContain('Background motion:')
  })

  it('提供时包含镜头时间线', () => {
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
    expect(result.videoPrompt).toContain('No character dialogue')
    expect(result.videoPrompt).toContain('ambient sound: wind in trees')
  })

  it('处理多个角色', () => {
    const char2: NormalizedCharacter = {
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

  it('组合角色和场景的负面提示词', () => {
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

  it('未指定时使用默认时长 5', () => {
    const shot = makeShot({ duration: 0 })
    const result = buildShotVideoPrompt({
      shot,
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('total 5s')
  })

  it('朝向部分使用角色 ID 作为回退名称', () => {
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
