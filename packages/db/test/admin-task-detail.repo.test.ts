import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { getDb } from '../src/db'
import { getAdminTaskDetail } from '../src/repositories/admin.repo'
import { createCanvasProject } from '../src/repositories/canvas-projects.repo'
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

  it('returns null for unknown taskId', async () => {
    const detail = await getAdminTaskDetail('00000000-0000-0000-0000-000000000000')
    expect(detail).toBeNull()
  })

  it('returns task with empty pipelineRuns when no runs linked', async () => {
    const task = await seedTask({ type: 'generate.video', domain: 'generate' })
    const detail = await getAdminTaskDetail(task.id)

    expect(detail).not.toBeNull()
    expect(detail!.task.id).toBe(task.id)
    expect(detail!.task.type).toBe('generate.video')
    expect(detail!.pipelineRuns).toEqual([])
  })

  it('returns linked pipeline runs ordered by createdAt asc with computed durationMs', async () => {
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

  it('returns null durationMs when finishedAt is missing', async () => {
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

  it('passes through outputSummary jsonb', async () => {
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
})
