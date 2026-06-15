import type { CanvasCharacterRow, CanvasContinuityRow, CanvasLocationRow, CanvasProjectRow, CanvasShotRow } from '@excuse/db'
import { describe, expect, it } from 'bun:test'
import { mapCharacter, mapLocation, mapProjectDetail, mapShot } from '../src/modules/canvas/mapper'

function makeCharacterRow(overrides: Partial<CanvasCharacterRow> = {}): CanvasCharacterRow {
  return {
    id: 'char-1',
    projectId: 'proj-1',
    name: 'Alice',
    role: 'protagonist',
    description: 'A young woman',
    identityPrompt: 'long black hair, red dress',
    negativePrompt: 'blurry',
    profileJson: {
      name: 'Alice',
      role: 'protagonist',
      age: '20-25',
      gender: 'female',
      bodyShape: 'slim',
      height: '165cm',
      face: { shape: 'oval', eyes: 'brown', eyebrows: 'thin', nose: 'small', mouth: 'pink', skin: 'fair' },
      hair: { color: 'black', style: 'straight', length: 'long' },
      costume: { mainColor: 'red', style: 'dress', material: 'silk', details: [] },
      accessories: [],
      identityPrompt: 'long black hair, red dress',
      negativePrompt: 'blurry',
    },
    referenceImageUrl: 'https://cdn.example.com/alice.jpg',
    turnaroundSheetUrl: 'https://cdn.example.com/alice-turnaround.jpg',
    locked: false,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T12:00:00Z'),
    ...overrides,
  }
}

function makeLocationRow(overrides: Partial<CanvasLocationRow> = {}): CanvasLocationRow {
  return {
    id: 'loc-1',
    projectId: 'proj-1',
    name: 'Dark Forest',
    type: 'exterior',
    profileJson: {
      name: 'Dark Forest',
      type: 'exterior',
      location: 'An ancient forest',
      era: 'medieval',
      atmosphere: 'mysterious',
      visualRules: { colorPalette: ['dark green', 'brown'], lighting: 'dim', architecture: 'none', floor: 'dirt', backgroundElements: ['trees'] },
      cameraRules: { axisDirection: 'left-to-right', allowedAngles: ['wide'], forbiddenAngles: [] },
      scenePrompt: 'A mysterious dark forest',
      negativePrompt: 'bright, sunny',
    },
    scenePrompt: 'A mysterious dark forest',
    negativePrompt: 'bright, sunny',
    referenceImageUrl: 'https://cdn.example.com/forest.jpg',
    locked: false,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T12:00:00Z'),
    ...overrides,
  }
}

function makeShotRow(overrides: Partial<CanvasShotRow> = {}): CanvasShotRow {
  return {
    id: 'shot-1',
    projectId: 'proj-1',
    shotIndex: 1,
    duration: 5,
    locationId: 'loc-1',
    characterIdsJson: ['char-1'],
    narrative: 'Alice walks through the forest',
    cameraJson: { shotSize: 'medium', angle: 'front', movement: 'dolly in', lens: '35mm' },
    continuityJson: { screenDirection: 'left_to_right', characterFacing: { 'char-1': 'right' }, actionStart: 'standing', actionEnd: 'walking', emotionStart: 'neutral', emotionEnd: 'worried' },
    timelineJson: [{ time: '0s-1s', action: 'standing' }],
    environmentJson: { backgroundMotion: 'wind', lighting: 'moonlight' },
    videoPrompt: 'A girl walks through a dark forest',
    negativePrompt: 'blurry',
    videoTaskId: 'task-123',
    videoUrl: 'https://cdn.example.com/video.mp4',
    status: 'completed',
    errorMessage: null,
    referenceAssetsJson: [],
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T12:00:00Z'),
    ...overrides,
  }
}

function makeProjectRow(overrides: Partial<CanvasProjectRow> = {}): CanvasProjectRow {
  return {
    id: 'proj-1',
    accountId: 'acc-1',
    title: 'Test Project',
    storyText: 'Once upon a time...',
    status: 'analyzed',
    analysisJson: {
      summary: 'A test story',
      mainConflict: 'good vs evil',
      timeline: ['start', 'middle', 'end'],
      characterNames: ['Alice'],
      sceneNames: ['Forest'],
    },
    modelPreferencesJson: null,
    canvasLayout: null,
    isDeleted: false,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T12:00:00Z'),
    ...overrides,
  }
}

// ── mapCharacter ──────────────────────────────────────

describe('mapCharacter', () => {
  it('正确映射所有字段', () => {
    const row = makeCharacterRow()
    const dto = mapCharacter(row)

    expect(dto.id).toBe('char-1')
    expect(dto.projectId).toBe('proj-1')
    expect(dto.name).toBe('Alice')
    expect(dto.role).toBe('protagonist')
    expect(dto.description).toBe('A young woman')
    expect(dto.identityPrompt).toBe('long black hair, red dress')
    expect(dto.negativePrompt).toBe('blurry')
    expect(dto.referenceImageUrl).toBe('https://cdn.example.com/alice.jpg')
    expect(dto.turnaroundSheetUrl).toBe('https://cdn.example.com/alice-turnaround.jpg')
    expect(dto.locked).toBe(false)
    expect(dto.createdAt).toBe('2025-01-01T00:00:00.000Z')
    expect(dto.updatedAt).toBe('2025-01-01T12:00:00.000Z')
  })

  it('解析 profileJson', () => {
    const dto = mapCharacter(makeCharacterRow())
    expect(dto.profile).not.toBeNull()
    expect(dto.profile!.name).toBe('Alice')
    expect(dto.profile!.face.shape).toBe('oval')
  })

  it('处理 null profileJson', () => {
    const row = makeCharacterRow({ profileJson: null })
    const dto = mapCharacter(row)
    expect(dto.profile).toBeNull()
  })

  it('处理 null 可选字段', () => {
    const row = makeCharacterRow({
      role: null,
      description: null,
      identityPrompt: null,
      negativePrompt: null,
      referenceImageUrl: null,
      turnaroundSheetUrl: null,
    })
    const dto = mapCharacter(row)
    expect(dto.role).toBeNull()
    expect(dto.description).toBeNull()
    expect(dto.identityPrompt).toBeNull()
    expect(dto.negativePrompt).toBeNull()
    expect(dto.referenceImageUrl).toBeNull()
    expect(dto.turnaroundSheetUrl).toBeNull()
  })
})

// ── mapLocation ──────────────────────────────────────

describe('mapLocation', () => {
  it('正确映射所有字段', () => {
    const row = makeLocationRow()
    const dto = mapLocation(row)

    expect(dto.id).toBe('loc-1')
    expect(dto.projectId).toBe('proj-1')
    expect(dto.name).toBe('Dark Forest')
    expect(dto.type).toBe('exterior')
    expect(dto.scenePrompt).toBe('A mysterious dark forest')
    expect(dto.negativePrompt).toBe('bright, sunny')
    expect(dto.referenceImageUrl).toBe('https://cdn.example.com/forest.jpg')
    expect(dto.locked).toBe(false)
    expect(dto.createdAt).toBe('2025-01-01T00:00:00.000Z')
    expect(dto.updatedAt).toBe('2025-01-01T12:00:00.000Z')
  })

  it('解析 profileJson', () => {
    const dto = mapLocation(makeLocationRow())
    expect(dto.profile).not.toBeNull()
    expect(dto.profile!.name).toBe('Dark Forest')
    expect(dto.profile!.atmosphere).toBe('mysterious')
  })

  it('处理 null profileJson', () => {
    const dto = mapLocation(makeLocationRow({ profileJson: null }))
    expect(dto.profile).toBeNull()
  })

  it('处理 null 可选字段', () => {
    const row = makeLocationRow({
      scenePrompt: null,
      negativePrompt: null,
      referenceImageUrl: null,
    })
    const dto = mapLocation(row)
    expect(dto.scenePrompt).toBeNull()
    expect(dto.negativePrompt).toBeNull()
    expect(dto.referenceImageUrl).toBeNull()
  })
})

// ── mapShot ──────────────────────────────────────────

describe('mapShot', () => {
  it('正确映射所有字段', () => {
    const row = makeShotRow()
    const dto = mapShot(row)

    expect(dto.id).toBe('shot-1')
    expect(dto.projectId).toBe('proj-1')
    expect(dto.shotIndex).toBe(1)
    expect(dto.duration).toBe(5)
    expect(dto.locationId).toBe('loc-1')
    expect(dto.characterIds).toEqual(['char-1'])
    expect(dto.narrative).toBe('Alice walks through the forest')
    expect(dto.camera).toEqual({ shotSize: 'medium', angle: 'front', movement: 'dolly in', lens: '35mm' })
    expect(dto.continuity).toEqual({ screenDirection: 'left_to_right', characterFacing: { 'char-1': 'right' }, actionStart: 'standing', actionEnd: 'walking', emotionStart: 'neutral', emotionEnd: 'worried' })
    expect(dto.timeline).toEqual([{ time: '0s-1s', action: 'standing' }])
    expect(dto.environment).toEqual({ backgroundMotion: 'wind', lighting: 'moonlight' })
    expect(dto.videoPrompt).toBe('A girl walks through a dark forest')
    expect(dto.negativePrompt).toBe('blurry')
    expect(dto.videoTaskId).toBe('task-123')
    expect(dto.videoUrl).toBe('https://cdn.example.com/video.mp4')
    expect(dto.status).toBe('completed')
    expect(dto.errorMessage).toBeNull()
    expect(dto.referenceAssets).toEqual([])
    expect(dto.createdAt).toBe('2025-01-01T00:00:00.000Z')
    expect(dto.updatedAt).toBe('2025-01-01T12:00:00.000Z')
  })

  it('处理 null 可选字段', () => {
    const row = makeShotRow({
      locationId: null,
      characterIdsJson: [],
      timelineJson: null,
      environmentJson: null,
      videoPrompt: null,
      negativePrompt: null,
      videoTaskId: null,
      videoUrl: null,
      errorMessage: null,
    })
    const dto = mapShot(row)
    expect(dto.locationId).toBeNull()
    expect(dto.characterIds).toEqual([])
    expect(dto.timeline).toBeNull()
    expect(dto.environment).toBeNull()
    expect(dto.videoPrompt).toBeNull()
    expect(dto.negativePrompt).toBeNull()
    expect(dto.videoTaskId).toBeNull()
    expect(dto.videoUrl).toBeNull()
    expect(dto.errorMessage).toBeNull()
    expect(dto.referenceAssets).toEqual([])
  })
})

// ── mapProjectDetail ─────────────────────────────────

describe('mapProjectDetail', () => {
  it('组合完整项目详情', () => {
    const project = makeProjectRow()
    const characters = [makeCharacterRow()]
    const locations = [makeLocationRow()]
    const shots = [makeShotRow()]

    const dto = mapProjectDetail(project, characters, locations, shots, null)

    expect(dto.id).toBe('proj-1')
    expect(dto.accountId).toBe('acc-1')
    expect(dto.title).toBe('Test Project')
    expect(dto.storyText).toBe('Once upon a time...')
    expect(dto.status).toBe('analyzed')
    expect(dto.analysis).not.toBeNull()
    expect(dto.analysis!.summary).toBe('A test story')
    expect(dto.characters).toHaveLength(1)
    expect(dto.characters[0]!.name).toBe('Alice')
    expect(dto.locations).toHaveLength(1)
    expect(dto.locations[0]!.name).toBe('Dark Forest')
    expect(dto.shots).toHaveLength(1)
    expect(dto.shots[0]!.shotIndex).toBe(1)
    expect(dto.continuityIssues).toEqual([])
    expect(dto.canvasLayout).toBeNull()
    expect(dto.createdAt).toBe('2025-01-01T00:00:00.000Z')
    expect(dto.updatedAt).toBe('2025-01-01T12:00:00.000Z')
  })

  it('处理连贯性问题', () => {
    const report: CanvasContinuityRow = {
      id: 'report-1',
      projectId: 'proj-1',
      issuesJson: [
        { severity: 'error', code: 'MISSING_SCENE', message: 'test' },
        { severity: 'warning', code: 'FACING_CHANGE', message: 'test' },
      ],
      createdAt: new Date('2025-01-01T00:00:00Z'),
    }

    const dto = mapProjectDetail(makeProjectRow(), [], [], [], report)
    expect(dto.continuityIssues).toHaveLength(2)
    expect(dto.continuityIssues[0]!.severity).toBe('error')
  })

  it('处理 null 连贯性报告', () => {
    const dto = mapProjectDetail(makeProjectRow(), [], [], [], null)
    expect(dto.continuityIssues).toEqual([])
  })

  it('处理空集合', () => {
    const dto = mapProjectDetail(makeProjectRow(), [], [], [], null)
    expect(dto.characters).toEqual([])
    expect(dto.locations).toEqual([])
    expect(dto.shots).toEqual([])
  })

  it('处理 null title', () => {
    const project = makeProjectRow({ title: null })
    const dto = mapProjectDetail(project, [], [], [], null)
    expect(dto.title).toBeNull()
  })

  it('处理 null analysisJson', () => {
    const project = makeProjectRow({ analysisJson: null })
    const dto = mapProjectDetail(project, [], [], [], null)
    expect(dto.analysis).toBeNull()
  })
})
