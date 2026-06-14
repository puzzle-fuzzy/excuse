import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Developers from '../src/pages/Developers'

function renderDevelopers() {
  return render(
    <MemoryRouter>
      <Developers />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
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
    expect(screen.getByText('qwen-plus')).toBeInTheDocument()
    expect(screen.getByText('gpt-4o')).toBeInTheDocument()
    expect(screen.getAllByText('qwen-max').length).toBeGreaterThan(0)
  })

  it('shows streaming limitation message', () => {
    renderDevelopers()
    expect(screen.getByText(/暂不支持 streaming|不支持 streaming|streaming/i)).toBeInTheDocument()
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
})
