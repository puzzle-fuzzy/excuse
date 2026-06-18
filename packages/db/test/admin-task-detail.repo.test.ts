import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { getDb } from '../src/db'
import { getAdminTaskDetail } from '../src/repositories/admin.repo'
import { createCanvasProject } from '../src/repositories/canvas-projects.repo'
import { createGenerationRecord } from '../src/repositories/generation-records.repo'
import { createTask } from '../src/repositories/tasks.repo'
import { canvasPipelineRuns } from '../src/schema/canvas-pipeline-runs'
import {
  beginTestTransaction,
  initTestDb,
  rollbackTestTransaction,
  teardownTestDb,
} from './helpers/test-db'

describe('getAdminTaskDetail', () => {
  let accountId: string

  beforeAll(async () => {
    await initTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  beforeEach(async () => {
    const ctx = await beginTestTransaction()
    accountId = ctx.accountId
  })

  afterEach(async () => {
    await rollbackTestTransaction()
  })

  async function seedTask(overrides: Record<string, unknown> = {}) {
    return createTask({
      accountId,
      type: 'canvas.analyze',
      domain: 'canvas',
      status: 'failed',
      ...overrides,
    })
  }

  async function seedProject() {
    return createCanvasProject({
      accountId,
      storyText: '一个测试故事',
      status: 'draft',
    })
  }

  async function seedPipelineRun(values: {
    taskId: string
    projectId: string
    phase?: 'analyze' | 'characters' | 'storyboard'
    status?: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
    startedAt?: Date | null
    finishedAt?: Date | null
    errorMessage?: string | null
    outputSummary?: Record<string, unknown> | null
    createdAt?: Date
  }) {
    const [row] = await getDb()
      .insert(canvasPipelineRuns)
      .values({
        taskId: values.taskId,
        projectId: values.projectId,
        phase: values.phase ?? 'analyze',
        status: values.status ?? 'pending',
        startedAt: values.startedAt ?? null,
        finishedAt: values.finishedAt ?? null,
        errorMessage: values.errorMessage ?? null,
        outputSummaryJson: values.outputSummary ?? null,
        createdAt: values.createdAt,
      })
      .returning()
    return row!
  }

  it('未知 taskId 返回 null', async () => {
    const detail = await getAdminTaskDetail('00000000-0000-0000-0000-000000000000')
    expect(detail).toBeNull()
  })

  it('无关联 pipeline run 时返回空 pipelineRuns', async () => {
    const task = await seedTask({ type: 'media.extract-audio', domain: 'subtitle' })
    const detail = await getAdminTaskDetail(task.id)

    expect(detail).not.toBeNull()
    expect(detail!.task.id).toBe(task.id)
    expect(detail!.task.type).toBe('media.extract-audio')
    expect(detail!.pipelineRuns).toEqual([])
  })

  it('返回关联的 pipeline run 并按 createdAt asc 排序且计算 durationMs', async () => {
    const project = await seedProject()
    const baseTime = new Date('2026-06-14T00:00:00.000Z')
    const task = await seedTask({ projectId: project.id })

    // 故意以倒序插入，验证 repo 按 createdAt asc 排序
    await seedPipelineRun({
      taskId: task.id,
      projectId: project.id,
      phase: 'storyboard',
      status: 'failed',
      startedAt: new Date(baseTime.getTime() + 60_000),
      finishedAt: new Date(baseTime.getTime() + 90_000),
      errorMessage: 'LLM 输出校验失败',
      createdAt: new Date(baseTime.getTime() + 60_000),
    })
    await seedPipelineRun({
      taskId: task.id,
      projectId: project.id,
      phase: 'analyze',
      status: 'succeeded',
      startedAt: baseTime,
      finishedAt: new Date(baseTime.getTime() + 30_000),
      createdAt: baseTime,
    })

    const detail = await getAdminTaskDetail(task.id)

    expect(detail!.pipelineRuns.length).toBe(2)
    // createdAt asc：analyze 在前
    expect(detail!.pipelineRuns[0]!.phase).toBe('analyze')
    expect(detail!.pipelineRuns[0]!.status).toBe('succeeded')
    expect(detail!.pipelineRuns[0]!.durationMs).toBe(30_000)
    expect(detail!.pipelineRuns[0]!.errorMessage).toBeNull()
    expect(detail!.pipelineRuns[1]!.phase).toBe('storyboard')
    expect(detail!.pipelineRuns[1]!.status).toBe('failed')
    expect(detail!.pipelineRuns[1]!.durationMs).toBe(30_000)
    expect(detail!.pipelineRuns[1]!.errorMessage).toBe('LLM 输出校验失败')
  })

  it('finishedAt 缺失时 durationMs 为 null', async () => {
    const project = await seedProject()
    const task = await seedTask({ projectId: project.id })

    await seedPipelineRun({
      taskId: task.id,
      projectId: project.id,
      phase: 'characters',
      status: 'running',
      startedAt: new Date(),
      finishedAt: null,
    })

    const detail = await getAdminTaskDetail(task.id)
    expect(detail!.pipelineRuns.length).toBe(1)
    expect(detail!.pipelineRuns[0]!.durationMs).toBeNull()
    expect(detail!.pipelineRuns[0]!.finishedAt).toBeNull()
  })

  it('透传 outputSummary jsonb', async () => {
    const project = await seedProject()
    const task = await seedTask({ projectId: project.id })
    const summary = { shotCount: 12, characterCount: 3 }

    await seedPipelineRun({
      taskId: task.id,
      projectId: project.id,
      phase: 'storyboard',
      status: 'succeeded',
      outputSummary: summary,
    })

    const detail = await getAdminTaskDetail(task.id)
    expect(detail!.pipelineRuns[0]!.outputSummary).toEqual(summary)
  })

  // ── generation record 级联诊断 ──────────────────────────────────────────────

  it('generationRecordId 直接命中时返回 direct 关联生成记录', async () => {
    const record = await createGenerationRecord({
      accountId,
      model: 'ffmpeg-burn',
      category: 'subtitle' as const,
      inputParams: { prompt: 'burn export' },
      totalPriceCents: 80,
    })
    const task = await seedTask({
      type: 'media.burn-subtitle',
      domain: 'subtitle',
      generationRecordId: record.id,
    })

    const detail = await getAdminTaskDetail(task.id)

    expect(detail!.generationRecords.length).toBe(1)
    expect(detail!.generationRecords[0]!.id).toBe(record.id)
    expect(detail!.generationRecords[0]!.matchReason).toBe('direct')
    expect(detail!.generationRecords[0]!.model).toBe('ffmpeg-burn')
    expect(detail!.generationRecords[0]!.costCents).toBe(80)
  })

  it('generationRecordId 指向已删除记录时返回空数组（不报错）', async () => {
    const task = await seedTask({
      generationRecordId: '00000000-0000-0000-0000-000000000000',
    })

    const detail = await getAdminTaskDetail(task.id)

    expect(detail!.generationRecords).toEqual([])
  })

  it('Canvas worker 写入 workerTaskId 时返回 worker-task 精确关联', async () => {
    const task = await seedTask({ type: 'canvas.videos', domain: 'canvas' })
    const record = await createGenerationRecord({
      accountId,
      model: 'wanx2.1-t2v',
      category: 'video' as const,
      inputParams: {
        source: 'canvas',
        projectId: task.projectId ?? '00000000-0000-0000-0000-000000000000',
        workerTaskId: task.id,
        canvasAssetId: crypto.randomUUID(),
        prompt: 'canvas shot',
      },
      totalPriceCents: 120,
    })

    const detail = await getAdminTaskDetail(task.id)

    expect(detail!.generationRecords.length).toBe(1)
    expect(detail!.generationRecords[0]!.id).toBe(record.id)
    expect(detail!.generationRecords[0]!.matchReason).toBe('worker-task')
  })

  it('Canvas worker 写入 pipelineRunId 时返回 pipeline-run 精确关联', async () => {
    const pipelineRunId = crypto.randomUUID()
    const task = await seedTask({
      type: 'canvas.videos',
      domain: 'canvas',
      targetId: pipelineRunId,
    })
    const record = await createGenerationRecord({
      accountId,
      model: 'wanx2.1-t2v',
      category: 'video' as const,
      inputParams: {
        source: 'canvas',
        projectId: task.projectId ?? '00000000-0000-0000-0000-000000000000',
        pipelineRunId,
        canvasAssetId: crypto.randomUUID(),
        prompt: 'canvas shot',
      },
      totalPriceCents: 140,
    })

    const detail = await getAdminTaskDetail(task.id)

    expect(detail!.generationRecords.length).toBe(1)
    expect(detail!.generationRecords[0]!.id).toBe(record.id)
    expect(detail!.generationRecords[0]!.matchReason).toBe('pipeline-run')
  })

  it('无直接关联时按 accountId + 时间窗口返回候选（time-window）', async () => {
    const task = await seedTask({ type: 'canvas.videos', domain: 'canvas' })
    const inWindow = await createGenerationRecord({
      accountId,
      model: 'wanx2.1-t2v',
      category: 'video' as const,
      inputParams: { prompt: 'canvas shot' },
      totalPriceCents: 120,
    })

    const detail = await getAdminTaskDetail(task.id)

    expect(detail!.generationRecords.length).toBe(1)
    expect(detail!.generationRecords[0]!.id).toBe(inWindow.id)
    expect(detail!.generationRecords[0]!.matchReason).toBe('time-window')
    expect(detail!.generationRecords[0]!.costCents).toBe(120)
  })

  it('时间窗口外的生成记录不返回', async () => {
    const task = await seedTask({ type: 'canvas.videos', domain: 'canvas' })
    // 1 小时前创建的记录，超出 ±2min 窗口
    await createGenerationRecord({
      accountId,
      model: 'wanx2.1-t2v',
      category: 'video' as const,
      inputParams: { prompt: 'stale' },
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    })

    const detail = await getAdminTaskDetail(task.id)

    expect(detail!.generationRecords).toEqual([])
  })
})
