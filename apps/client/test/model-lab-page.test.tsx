import type { GenerationRecord, ModelConfig } from '../src/api/client'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchModels, generate } from '../src/api/client'
import ModelLab from '../src/pages/ModelLab'

vi.mock('../src/api/client', () => ({
  fetchModels: vi.fn(),
  generate: vi.fn(),
  uploadFile: vi.fn(),
}))

const mockFetchModels = vi.mocked(fetchModels)
const mockGenerate = vi.mocked(generate)

const textModel: ModelConfig = {
  id: 'qwen-plus',
  name: 'Qwen Plus',
  category: 'text',
  type: 'generation',
  description: '通用文本模型',
  endpoint: '/dashscope/text',
  async: false,
  requestType: 'chat',
  pricing: {
    unit: 'token',
    inputPriceCents: 80,
    outputPriceCents: 200,
  },
  parameters: [
    {
      name: 'prompt',
      type: 'text',
      description: '提示词',
      required: true,
      defaultValue: '',
    },
    {
      name: 'temperature',
      type: 'number',
      description: '温度',
      defaultValue: 0.7,
      min: 0,
      max: 2,
    },
  ],
}

const secondTextModel: ModelConfig = {
  ...textModel,
  id: 'qwen-turbo',
  name: 'Qwen Turbo',
  description: '轻量文本模型',
  pricing: {
    unit: 'token',
    inputPriceCents: 30,
    outputPriceCents: 60,
  },
}

function makeRecord(overrides?: Partial<GenerationRecord>): GenerationRecord {
  return {
    id: 'record-1',
    accountId: 'account-1',
    taskId: null,
    model: 'qwen-plus',
    category: 'text',
    status: 'succeeded',
    inputParams: { prompt: '写一句测试文案', temperature: 0.7 },
    outputResult: { type: 'text', text: '测试输出' },
    cost: {
      unit: 'token',
      totalPriceCents: 1,
      totalPrice: 0.01,
      inputTokens: 10,
      outputTokens: 12,
    },
    totalPriceCents: 1,
    errorMessage: null,
    retryCount: 0,
    traceId: null,
    dedupeKey: null,
    hiddenAt: null,
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:01.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockFetchModels.mockResolvedValue({ models: [textModel, secondTextModel] })
  mockGenerate.mockResolvedValue({ success: true, record: makeRecord() })
})

describe('model lab page', () => {
  it('loads models and renders the internal lab title', async () => {
    render(<ModelLab />)

    expect(await screen.findByText('Model Lab')).toBeInTheDocument()
    expect(screen.getByText('内部实验')).toBeInTheDocument()
    expect(screen.getAllByText(/Qwen Plus/).length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/提示词/)).toBeInTheDocument()
  })

  it('submits selected model parameters and shows returned record', async () => {
    const user = userEvent.setup()
    render(<ModelLab />)

    const prompt = await screen.findByLabelText(/提示词/)
    await user.type(prompt, '写一句测试文案')
    await user.click(screen.getByRole('button', { name: /运行实验/ }))

    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledWith({
        model: 'qwen-plus',
        parameters: expect.objectContaining({
          prompt: '写一句测试文案',
          temperature: 0.7,
        }),
        referenceFileIds: undefined,
      })
    })
    expect(await screen.findByText(/文本输出 4 字/)).toBeInTheDocument()
    expect(screen.getByText(/#record-1/)).toBeInTheDocument()
  })

  it('shows model loading error', async () => {
    mockFetchModels.mockRejectedValueOnce(new Error('模型服务不可用'))

    render(<ModelLab />)

    expect(await screen.findByText('模型服务不可用')).toBeInTheDocument()
  })

  it('runs same prompt comparison across selected models', async () => {
    const user = userEvent.setup()
    mockGenerate.mockImplementation(async ({ model }) => ({
      success: true,
      record: makeRecord({
        id: `record-${model}`,
        model,
        outputResult: { type: 'text', text: `${model} 输出` },
      }),
    }))

    render(<ModelLab />)

    await user.type(await screen.findByLabelText(/提示词/), '同一个 prompt')
    await user.click(screen.getByText('Qwen Turbo'))
    await user.click(screen.getByRole('button', { name: /运行对比实验/ }))

    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledTimes(2)
    })
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ model: 'qwen-plus' }))
    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ model: 'qwen-turbo' }))
    expect(await screen.findByText(/qwen-plus 输出/)).toBeInTheDocument()
    expect(screen.getByText(/qwen-turbo 输出/)).toBeInTheDocument()
  })

  it('saves selected model as canvas default and applies it back', async () => {
    const user = userEvent.setup()
    render(<ModelLab />)

    expect(await screen.findByText('Canvas 默认配置')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /保存当前模型/ }))

    await waitFor(() => {
      expect(screen.getAllByText('qwen-plus').length).toBeGreaterThan(0)
    })
    expect(localStorage.getItem('excuse:model-lab:canvas-defaults')).toContain('qwen-plus')

    await user.selectOptions(screen.getByDisplayValue('Qwen Plus - qwen-plus'), 'qwen-turbo')
    expect(screen.getAllByText('Qwen Turbo').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /应用到当前分类/ }))
    expect(screen.getByDisplayValue('Qwen Plus - qwen-plus')).toBeInTheDocument()
  })
})
