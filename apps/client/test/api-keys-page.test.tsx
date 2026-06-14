import type { ApiKeyDTO, CreatedApiKey } from '@excuse/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiKey, listApiKeys, revokeApiKey } from '../src/api/api-keys'
import { apiKeyQueryKeys } from '../src/api/query-client'

import ApiKeys from '../src/pages/ApiKeys'

// Mock API
vi.mock('../src/api/api-keys', () => ({
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}))

const mockListApiKeys = vi.mocked(listApiKeys)
const mockCreateApiKey = vi.mocked(createApiKey)
const mockRevokeApiKey = vi.mocked(revokeApiKey)

function makeKey(overrides?: Partial<ApiKeyDTO>): ApiKeyDTO {
  return {
    id: 'key-1',
    prefix: 'exc_',
    name: '测试密钥',
    lastUsedAt: null,
    createdAt: '2024-06-01T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  }
}

function renderApiKeys(queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ApiKeys />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('api keys page', () => {
  it('shows loading state', () => {
    mockListApiKeys.mockReturnValue(new Promise(() => {}))
    renderApiKeys()
    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('shows key list with prefix on success', async () => {
    mockListApiKeys.mockResolvedValue([makeKey({ prefix: 'exc_abcd' }), makeKey({ id: 'key-2', prefix: 'exc_xyz', name: null })])
    renderApiKeys()
    expect(await screen.findByText('测试密钥')).toBeInTheDocument()
    expect(screen.getByText('未命名密钥')).toBeInTheDocument()
    expect(screen.getByText(/exc_abcd/)).toBeInTheDocument()
  })

  it('shows empty state when no keys', async () => {
    mockListApiKeys.mockResolvedValue([])
    renderApiKeys()
    expect(await screen.findByText(/暂无 API 密钥/)).toBeInTheDocument()
  })

  it('shows created secret with one-time warning', async () => {
    const user = userEvent.setup()
    mockListApiKeys.mockResolvedValue([])
    const created: CreatedApiKey = { key: 'exc_secret123_fullkey', prefix: 'exc_se' }
    mockCreateApiKey.mockResolvedValue(created)

    renderApiKeys()

    // Wait for page to finish loading
    await screen.findByText(/暂无 API 密钥/)

    // Click "创建密钥"
    await user.click(screen.getByText('创建密钥'))

    // Fill name and submit
    const input = screen.getByPlaceholderText('例如：生产环境')
    await user.type(input, '新密钥')
    // Find the submit button inside the form
    const submitBtn = screen.getAllByRole('button').find(b => b.textContent?.trim() === '创建' && b.closest('form'))
    await user.click(submitBtn!)

    // Should show secret and one-time warning
    expect(await screen.findByText('完整密钥只显示一次，请立即复制保存。')).toBeInTheDocument()
    expect(screen.getByText('exc_secret123_fullkey')).toBeInTheDocument()
  })

  it('copy button calls navigator.clipboard', async () => {
    const user = userEvent.setup()
    mockListApiKeys.mockResolvedValue([])
    const created: CreatedApiKey = { key: 'exc_test_key', prefix: 'exc_t' }
    mockCreateApiKey.mockResolvedValue(created)

    const clipboardSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()

    renderApiKeys()

    // Wait for page to finish loading
    await screen.findByText(/暂无 API 密钥/)

    await user.click(screen.getByText('创建密钥'))

    // Find and click the submit button inside the form
    const submitBtn = screen.getAllByRole('button').find(b => b.textContent?.trim() === '创建' && b.closest('form'))
    await user.click(submitBtn!)

    // Wait for secret display
    expect(await screen.findByText('exc_test_key')).toBeInTheDocument()

    // Click copy
    await user.click(screen.getByRole('button', { name: /复制/ }))
    expect(clipboardSpy).toHaveBeenCalledWith('exc_test_key')

    clipboardSpy.mockRestore()
  })

  it('revoke shows confirm dialog and calls revoke API', async () => {
    const user = userEvent.setup()
    const key = makeKey({ id: 'key-1' })
    mockListApiKeys.mockResolvedValue([key])
    mockRevokeApiKey.mockResolvedValue()

    renderApiKeys()

    // Wait for key to appear
    expect(await screen.findByText('测试密钥')).toBeInTheDocument()

    // Click revoke button on the key card (has trash icon)
    const revokeBtn = screen.getByRole('button', { name: /撤销/ })
    await user.click(revokeBtn)

    // Confirm dialog should appear
    expect(await screen.findByText('确认撤销密钥？')).toBeInTheDocument()

    // Click confirm in the dialog — the dialog has a second "撤销" button
    const allButtons = screen.getAllByRole('button')
    // Find the destructive confirm button (last one with "撤销" text)
    const confirmBtn = allButtons.filter(b => b.textContent?.trim() === '撤销').pop()
    await user.click(confirmBtn!)

    expect(mockRevokeApiKey).toHaveBeenCalledWith('key-1', expect.any(Object))
  })

  it('shows error state on list failure', async () => {
    mockListApiKeys.mockRejectedValue(new Error('加载 API 密钥列表失败'))
    renderApiKeys()
    expect(await screen.findByText('加载 API 密钥列表失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })

  it('shows "从未使用" for lastUsedAt=null', async () => {
    mockListApiKeys.mockResolvedValue([makeKey({ lastUsedAt: null })])
    renderApiKeys()
    expect(await screen.findByText(/从未使用/)).toBeInTheDocument()
  })
})

describe('apiKeyQueryKeys', () => {
  it('all key 包含 "api-keys"', () => {
    expect(apiKeyQueryKeys.all).toEqual(['api-keys'])
  })

  it('list key 包含 "api-keys" + "list"', () => {
    expect(apiKeyQueryKeys.list).toEqual(['api-keys', 'list'])
  })
})
