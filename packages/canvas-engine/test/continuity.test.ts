import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from '../src'
import { describe, expect, it } from 'bun:test'
import { validateShotContinuity } from '../src'

function makeShot(overrides: Partial<NormalizedShot> = {}): NormalizedShot {
  return {
    id: 'shot-1',
    shotIndex: 1,
    locationId: 'loc-1',
    characterIds: ['char-1'],
    narrative: 'A character walks',
    duration: 5,
    camera: { shotSize: 'medium', angle: 'front', movement: 'static', lens: '35mm' },
    continuity: {
      screenDirection: 'left_to_right',
      characterFacing: { 'char-1': 'right' },
      actionStart: 'standing still',
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
    identityPrompt: 'A young woman',
    negativePrompt: 'blurry',
    ...overrides,
  }
}

function makeLocation(overrides: Partial<NormalizedLocation> = {}): NormalizedLocation {
  return {
    id: 'loc-1',
    name: 'Forest',
    scenePrompt: 'A dark forest',
    negativePrompt: 'bright',
    cameraRules: {
      axisDirection: 'left_to_right',
      allowedAngles: ['front', 'side'],
      forbiddenAngles: [],
    },
    ...overrides,
  }
}

describe('validateShotContinuity', () => {
  it('有效镜头不返回问题', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing still',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'determined',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'determined',
          emotionEnd: 'angry',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues).toHaveLength(0)
  })

  it('空镜头列表不返回问题', () => {
    const issues = validateShotContinuity({
      shots: [],
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues).toHaveLength(0)
  })

  // ── MISSING_SCENE ──────────────────────────────────

  it('无效 locationId 时检测 MISSING_SCENE', () => {
    const shot = makeShot({ locationId: 'nonexistent-loc' })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      code: 'MISSING_SCENE',
      shotId: 'shot-1',
      shotIndex: 1,
    })
  })

  it('null locationId 不标记', () => {
    const shot = makeShot({ locationId: null })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const sceneIssues = issues.filter(i => i.code === 'MISSING_SCENE')
    expect(sceneIssues).toHaveLength(0)
  })

  // ── MISSING_CHARACTER ─────────────────────────────

  it('未分配角色时检测 MISSING_CHARACTER', () => {
    const shot = makeShot({ characterIds: [] })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const charIssues = issues.filter(i => i.code === 'MISSING_CHARACTER')
    expect(charIssues).toHaveLength(1)
    expect(charIssues[0]).toMatchObject({
      severity: 'error',
      shotId: 'shot-1',
      message: expect.stringContaining('没有关联任何角色'),
    })
  })

  it('无效 characterId 时检测 MISSING_CHARACTER', () => {
    const shot = makeShot({ characterIds: ['char-1', 'nonexistent'] })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const charIssues = issues.filter(i => i.code === 'MISSING_CHARACTER')
    expect(charIssues).toHaveLength(1)
    expect(charIssues[0]?.message).toContain('nonexistent')
  })

  // ── FORBIDDEN_CAMERA_ANGLE ────────────────────────

  it('检测 FORBIDDEN_CAMERA_ANGLE', () => {
    const location = makeLocation({
      cameraRules: {
        axisDirection: 'left_to_right',
        allowedAngles: ['front'],
        forbiddenAngles: ['back'],
      },
    })
    const shot = makeShot({
      camera: { shotSize: 'medium', angle: 'back', movement: 'static', lens: '35mm' },
    })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [location],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      code: 'FORBIDDEN_CAMERA_ANGLE',
      message: expect.stringContaining('back'),
    })
  })

  it('允许的角度不标记', () => {
    const location = makeLocation({
      cameraRules: {
        axisDirection: 'left_to_right',
        allowedAngles: ['front'],
        forbiddenAngles: ['back'],
      },
    })
    const shot = makeShot({
      camera: { shotSize: 'medium', angle: 'front', movement: 'static', lens: '35mm' },
    })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [location],
    })
    expect(issues.filter(i => i.code === 'FORBIDDEN_CAMERA_ANGLE')).toHaveLength(0)
  })

  // ── FACING_CHANGE ─────────────────────────────────

  it('同场景连续镜头检测 FACING_CHANGE', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'left' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const facingIssues = issues.filter(i => i.code === 'FACING_CHANGE')
    expect(facingIssues).toHaveLength(1)
    expect(facingIssues[0]).toMatchObject({
      severity: 'warning',
      shotId: 's2',
      message: expect.stringContaining('Alice'),
    })
  })

  it('画面方向变化时不标记 FACING_CHANGE', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'right_to_left',
          characterFacing: { 'char-1': 'left' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues.filter(i => i.code === 'FACING_CHANGE')).toHaveLength(0)
  })

  it('不同场景跳过 FACING_CHANGE', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        locationId: 'loc-1',
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        locationId: 'loc-2',
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'left' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation({ id: 'loc-1' }), makeLocation({ id: 'loc-2' })],
    })
    expect(issues.filter(i => i.code === 'FACING_CHANGE')).toHaveLength(0)
  })

  // ── ACTION_MISMATCH ───────────────────────────────

  it('同场景镜头检测 ACTION_MISMATCH', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking slowly',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'running fast',
          actionEnd: 'sprinting',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const actionIssues = issues.filter(i => i.code === 'ACTION_MISMATCH')
    expect(actionIssues).toHaveLength(1)
    expect(actionIssues[0]).toMatchObject({
      severity: 'warning',
      shotId: 's2',
    })
  })

  it('动作一致时不标记 ACTION_MISMATCH', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues.filter(i => i.code === 'ACTION_MISMATCH')).toHaveLength(0)
  })

  it('容忍动作匹配中的标点差异', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking，slowly',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'walkingslowly',
          actionEnd: 'running',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues.filter(i => i.code === 'ACTION_MISMATCH')).toHaveLength(0)
  })

  // ── EMOTION_MISMATCH ──────────────────────────────

  it('同场景镜头检测 EMOTION_MISMATCH', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'happy',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'sad',
          emotionEnd: 'angry',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const emotionIssues = issues.filter(i => i.code === 'EMOTION_MISMATCH')
    expect(emotionIssues).toHaveLength(1)
    expect(emotionIssues[0]).toMatchObject({
      severity: 'warning',
      message: expect.stringContaining('happy'),
    })
  })

  it('情绪一致时不标记 EMOTION_MISMATCH', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'determined',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'determined',
          emotionEnd: 'angry',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues.filter(i => i.code === 'EMOTION_MISMATCH')).toHaveLength(0)
  })

  // ── Multiple issues combined ──────────────────────

  it('跨镜头检测多种问题类型', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        locationId: 'bad-loc',
        characterIds: [],
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: {},
          actionStart: '',
          actionEnd: '',
          emotionStart: '',
          emotionEnd: '',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues.length).toBeGreaterThanOrEqual(2)
    const codes = issues.map(i => i.code)
    expect(codes).toContain('MISSING_SCENE')
    expect(codes).toContain('MISSING_CHARACTER')
  })
})
