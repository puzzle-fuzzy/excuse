import type { AuthContextValue } from '../src/auth/AuthContext'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../src/auth/AuthContext'
import Login from '../src/pages/Login'

function renderLogin(authOverrides: Partial<AuthContextValue> = {}) {
  const mockLogin = vi.fn()
  const authValue: AuthContextValue = {
    user: null,
    isLoading: false,
    login: mockLogin,
    register: async () => {},
    logout: () => {},
    ...authOverrides,
  }

  const result = render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div data-testid="home">Home</div>} />
          <Route path="/register" element={<div data-testid="register">Register</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )

  return { ...result, mockLogin }
}

describe('login 页面', () => {
  it('渲染登录表单', () => {
    renderLogin()

    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /登录/ })).toBeInTheDocument()
  })

  it('包含注册链接', () => {
    renderLogin()

    const registerLink = screen.getByText('注册')
    expect(registerLink).toBeInTheDocument()
    expect(registerLink.closest('a')).toHaveAttribute('href', '/register')
  })

  it('空表单提交显示验证错误', async () => {
    const user = userEvent.setup()
    const { mockLogin } = renderLogin()

    await user.click(screen.getByRole('button', { name: /登录/ }))

    expect(screen.getByText('请填写邮箱和密码')).toBeInTheDocument()
    expect(mockLogin).not.toHaveBeenCalled()
  })

  it('填写邮箱和密码后提交调用 login', async () => {
    const user = userEvent.setup()
    const { mockLogin } = renderLogin()

    mockLogin.mockResolvedValue(undefined)

    await user.type(screen.getByLabelText('邮箱'), 'test@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123')
    })
  })

  it('login 抛出错误时显示错误消息', async () => {
    const user = userEvent.setup()
    const { mockLogin } = renderLogin()

    mockLogin.mockRejectedValue(new Error('邮箱或密码错误'))

    await user.type(screen.getByLabelText('邮箱'), 'test@example.com')
    await user.type(screen.getByLabelText('密码'), 'wrong')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    await waitFor(() => {
      expect(screen.getByText('邮箱或密码错误')).toBeInTheDocument()
    })
  })

  it('只有空格的输入显示验证错误', async () => {
    const user = userEvent.setup()
    const { mockLogin } = renderLogin()

    await user.type(screen.getByLabelText('邮箱'), '   ')
    await user.type(screen.getByLabelText('密码'), '   ')
    await user.click(screen.getByRole('button', { name: /登录/ }))

    expect(screen.getByText('请填写邮箱和密码')).toBeInTheDocument()
    expect(mockLogin).not.toHaveBeenCalled()
  })
})
