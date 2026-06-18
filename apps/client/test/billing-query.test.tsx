import type { BillingStatistics } from '@excuse/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBillingStatistics } from '../src/api/billing'
import { billingQueryKeys } from '../src/api/query-client'

import Billing from '../src/pages/Billing'

// Mock billing API
vi.mock('../src/api/billing', () => ({
  getBillingStatistics: vi.fn(),
}))

const mockGetBillingStatistics = vi.mocked(getBillingStatistics)

function makeStats(overrides?: Partial<BillingStatistics>): BillingStatistics {
  return {
    totalCents: 100000,
    total: 1000,
    todayCents: 5000,
    today: 50,
    weekCents: 20000,
    week: 200,
    monthCents: 80000,
    month: 800,
    auditFailedCents: 1000,
    byCategory: [
      { category: 'image', totalCents: 60000, total: 600, percentage: 60 },
      { category: 'video', totalCents: 40000, total: 400, percentage: 40 },
    ],
    byModel: [
      { model: 'qwen-max', totalCents: 60000, total: 600, percentage: 60 },
      { model: 'wanx', totalCents: 40000, total: 400, percentage: 40 },
    ],
    dailyTrend: [
      { date: '2024-06-01', totalCents: 3000, total: 30 },
      { date: '2024-06-02', totalCents: 5000, total: 50 },
    ],
    ...overrides,
  }
}

function renderBilling(queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Billing />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('billing page', () => {
  it('shows loading state', () => {
    mockGetBillingStatistics.mockReturnValue(new Promise(() => {})) // never resolves
    const { container } = renderBilling()
    // 骨架屏代替了旧的「加载中...」文字
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('shows overview cards after successful fetch', async () => {
    mockGetBillingStatistics.mockResolvedValue(makeStats())
    renderBilling()
    expect(await screen.findByText('总额')).toBeInTheDocument()
    expect(screen.getByText('今日')).toBeInTheDocument()
    expect(screen.getByText('本周')).toBeInTheDocument()
    expect(screen.getByText('本月')).toBeInTheDocument()
  })

  it('shows category and model distribution', async () => {
    mockGetBillingStatistics.mockResolvedValue(makeStats())
    renderBilling()
    expect(await screen.findByText('图像生成')).toBeInTheDocument()
    expect(screen.getByText('视频生成')).toBeInTheDocument()
    expect(screen.getByText('qwen-max')).toBeInTheDocument()
    expect(screen.getByText('wanx')).toBeInTheDocument()
  })

  it('shows "暂无数据" for empty byCategory', async () => {
    // byCategory section
    const stats = makeStats({ byCategory: [], byModel: [] })
    mockGetBillingStatistics.mockResolvedValue(stats)
    renderBilling()
    const noDataElements = await screen.findAllByText('暂无数据')
    expect(noDataElements.length).toBeGreaterThanOrEqual(2) // category + model sections
  })

  it('shows error state and retry button on failure', async () => {
    mockGetBillingStatistics.mockRejectedValue(new Error('加载费用统计失败'))
    renderBilling()
    expect(await screen.findByText('加载费用统计失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })

  it('retry button refetches data', async () => {
    const user = userEvent.setup()
    // First call fails, second succeeds
    mockGetBillingStatistics
      .mockRejectedValueOnce(new Error('加载费用统计失败'))
      .mockResolvedValueOnce(makeStats())

    renderBilling()

    // Wait for error state
    expect(await screen.findByText('加载费用统计失败')).toBeInTheDocument()

    // Click retry
    await user.click(screen.getByRole('button', { name: /重试/ }))

    // Should load successfully
    expect(await screen.findByText('总额')).toBeInTheDocument()
    expect(mockGetBillingStatistics).toHaveBeenCalledTimes(2)
  })

  it('shows "暂无数据" for all-zero daily trend', async () => {
    const stats = makeStats({ dailyTrend: [{ date: '2024-06-01', totalCents: 0, total: 0 }] })
    mockGetBillingStatistics.mockResolvedValue(stats)
    renderBilling()
    // The trend card shows 暎无数据 (byCategory/byModel are non-empty, only trend is zero)
    const noDataElements = await screen.findAllByText('暂无数据')
    expect(noDataElements.length).toBeGreaterThanOrEqual(1)
  })
})

describe('billingQueryKeys', () => {
  it('all key 包含 "billing"', () => {
    expect(billingQueryKeys.all).toEqual(['billing'])
  })

  it('statistics key 包含 "billing" + "statistics"', () => {
    expect(billingQueryKeys.statistics).toEqual(['billing', 'statistics'])
  })
})
