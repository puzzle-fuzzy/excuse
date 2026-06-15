import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Developers from '../src/pages/Developers'

// Developers 页内 UsageSection 用 useQuery 拉 GET /v1/usage；本测试只断言静态
// 页面内容，故提供 QueryClientProvider + mock fetch 返回有效用量，避免真实网络
// 请求与控制台错误噪声。
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function renderDevelopers() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter>
        <Developers />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      totalCalls: 0,
      succeededCalls: 0,
      failedCalls: 0,
      totalTokens: 0,
      totalPriceCents: 0,
      recent: [],
    }),
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('developers page', () => {
  it('shows page title 开发者接入', () => {
    renderDevelopers()
    expect(screen.getByText('开发者接入')).toBeInTheDocument()
  })

  it('shows endpoint path /v1/chat/completions', () => {
    renderDevelopers()
    expect(screen.getAllByText(/POST \/v1\/chat\/completions/).length).toBeGreaterThan(0)
  })

  it('shows auth header Authorization: Bearer', () => {
    renderDevelopers()
    expect(screen.getAllByText(/Authorization: Bearer/).length).toBeGreaterThan(0)
  })

  it('shows model aliases including gpt-4o-mini and qwen-plus', () => {
    renderDevelopers()
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument()
    // qwen-plus 在定价表与多处 action 文案中重复出现，用 getAllByText 容忍多次匹配
    expect(screen.getAllByText('qwen-plus').length).toBeGreaterThan(0)
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getAllByText('qwen-max').length).toBeGreaterThan(0)
  })

  it('shows streaming limitation message', () => {
    renderDevelopers()
    expect(screen.getAllByText(/暂不支持 streaming|不支持 streaming|streaming/i).length).toBeGreaterThan(0)
  })

  it('copy button calls navigator.clipboard.writeText', async () => {
    const user = userEvent.setup()
    const clipboardSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()

    renderDevelopers()

    const copyButtons = screen.getAllByRole('button', { name: /复制/ })
    expect(copyButtons.length).toBeGreaterThan(0)

    await user.click(copyButtons[0])
    expect(clipboardSpy).toHaveBeenCalledTimes(1)

    clipboardSpy.mockRestore()
  })

  it('links to /api-keys from quick start', () => {
    renderDevelopers()
    const link = screen.getByText(/前往 API Keys 页面/).closest('a')
    expect(link).toHaveAttribute('href', '/api-keys')
  })

  it('shows error response section heading', () => {
    renderDevelopers()
    expect(screen.getByText('错误响应')).toBeInTheDocument()
  })

  it('shows all 7 OpenAI gateway error codes', () => {
    renderDevelopers()
    const codes = [
      'model_not_found',
      'invalid_model',
      'invalid_parameters',
      'insufficient_balance',
      'generation_failed',
      'stream_not_supported',
      'missing_user_message',
    ]
    for (const code of codes) {
      expect(screen.getByText(code)).toBeInTheDocument()
    }
  })

  it('shows action hints for insufficient_balance and stream_not_supported', () => {
    renderDevelopers()
    expect(screen.getByText(/充值后重试/)).toBeInTheDocument()
    // stream_not_supported 当前 action hint：提示哪些模型支持 streaming
    expect(screen.getByText(/部分旧模型不支持 stream/)).toBeInTheDocument()
  })
})
