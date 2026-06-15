import type { ProjectDTO } from '@excuse/shared'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Canvas from '../src/pages/Canvas'

// ── Mocks ─────────────────────────────────────────────────

vi.mock('../src/api/client', () => ({
  listCanvasProjects: vi.fn(),
  createCanvasProject: vi.fn(),
  deleteCanvasProject: vi.fn(),
  updateCanvasModelPreferences: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

const { listCanvasProjects, createCanvasProject, updateCanvasModelPreferences } = await import('../src/api/client')

// ── Fixtures ──────────────────────────────────────────────

function makeProjectDTO(overrides: Partial<ProjectDTO> = {}): ProjectDTO {
  return {
    id: 'proj-1',
    title: null,
    storyText: '',
    status: 'draft',
    characters: [],
    locations: [],
    shots: [],
    modelPreferences: null,
    layoutJson: null,
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  } as ProjectDTO
}

// ── Helpers ───────────────────────────────────────────────

function setLocalStoragePrefs(prefs: Record<string, unknown>) {
  localStorage.setItem(
    'excuse:model-lab:canvas-defaults',
    JSON.stringify({
      preferences: prefs,
      updatedAt: '2026-06-15T00:00:00Z',
      source: 'model-lab',
    }),
  )
}

function renderCanvas() {
  return render(
    <MemoryRouter initialEntries={['/canvas']}>
      <Routes>
        <Route path="/canvas" element={<Canvas />} />
        <Route path="/canvas/:projectId" element={<div data-testid="editor">Editor</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function createProject(user: ReturnType<typeof userEvent.setup>) {
  const textarea = await screen.findByPlaceholderText('在此粘贴故事文本...')
  await user.type(textarea, '一段故事')
  await user.click(screen.getByRole('button', { name: /创建并开始分析/ }))
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(listCanvasProjects).mockResolvedValue({ items: [] } as never)
  vi.mocked(createCanvasProject).mockResolvedValue({ data: makeProjectDTO({ id: 'proj-1' }) } as never)
  vi.mocked(updateCanvasModelPreferences).mockResolvedValue({ data: makeProjectDTO({ id: 'proj-1' }) } as never)
})

// ── Tests ─────────────────────────────────────────────────

describe('Canvas handleCreate — Model Lab 默认偏好接入', () => {
  it('localStorage 有偏好时，创建后调 updateCanvasModelPreferences 并导航', async () => {
    const user = userEvent.setup()
    setLocalStoragePrefs({ textModel: 'qwen3-max', imageModel: 'flux-pro' })
    renderCanvas()

    await createProject(user)

    await waitFor(() => {
      expect(createCanvasProject).toHaveBeenCalledWith({ title: undefined, storyText: '一段故事' })
    })
    await waitFor(() => {
      expect(updateCanvasModelPreferences).toHaveBeenCalledWith('proj-1', {
        textModel: 'qwen3-max',
        imageModel: 'flux-pro',
      })
    })
    expect(await screen.findByTestId('editor')).toBeInTheDocument()
  })

  it('localStorage 无偏好时，只调 createCanvasProject，不调 updateCanvasModelPreferences', async () => {
    const user = userEvent.setup()
    // 不设置 localStorage
    renderCanvas()

    await createProject(user)

    await waitFor(() => expect(createCanvasProject).toHaveBeenCalled())
    expect(await screen.findByTestId('editor')).toBeInTheDocument()
    expect(updateCanvasModelPreferences).not.toHaveBeenCalled()
  })

  it('localStorage 偏好全为空时，pickNonEmpty 过滤后不调 updateCanvasModelPreferences', async () => {
    const user = userEvent.setup()
    setLocalStoragePrefs({ textModel: '', imageModel: undefined, videoModel: undefined })
    renderCanvas()

    await createProject(user)

    await waitFor(() => expect(createCanvasProject).toHaveBeenCalled())
    expect(await screen.findByTestId('editor')).toBeInTheDocument()
    expect(updateCanvasModelPreferences).not.toHaveBeenCalled()
  })

  it('updateCanvasModelPreferences 失败时不阻塞导航（try/catch + console.warn）', async () => {
    const user = userEvent.setup()
    setLocalStoragePrefs({ textModel: 'qwen3-max' })
    vi.mocked(updateCanvasModelPreferences).mockRejectedValueOnce(new Error('network error'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderCanvas()

    await createProject(user)

    await waitFor(() => expect(createCanvasProject).toHaveBeenCalled())
    // 即便 PATCH 失败也照常导航到编辑器
    expect(await screen.findByTestId('editor')).toBeInTheDocument()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
