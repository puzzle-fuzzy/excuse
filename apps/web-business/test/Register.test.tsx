import type { AuthContextValue } from '../src/auth/AuthContext'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../src/auth/AuthContext'
import Register from '../src/pages/Register'

function renderRegister(authOverrides: Partial<AuthContextValue> = {}) {
  const mockRegister = vi.fn()
  const authValue: AuthContextValue = {
    user: null,
    isLoading: false,
    login: async () => {},
    register: mockRegister,
    logout: () => {},
    ...authOverrides,
  }

  const result = render(
    <AuthContext.Provider value={authValue}>
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<div data-testid="home">Home</div>} />
          <Route path="/login" element={<div data-testid="login">Login</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )

  return { ...result, mockRegister }
}

describe('register 页面', () => {
  it('渲染注册表单', () => {
    renderRegister()

    expect(screen.getByLabelText('用户名')).toBeInTheDocument()
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.getByLabelText('确认密码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /注册/ })).toBeInTheDocument()
  })

  it('包含登录链接', () => {
    renderRegister()

    const loginLink = screen.getByText('登录')
    expect(loginLink).toBeInTheDocument()
    expect(loginLink.closest('a')).toHaveAttribute('href', '/login')
  })

  it('空表单提交显示验证错误', async () => {
    const user = userEvent.setup()
    const { mockRegister } = renderRegister()

    await user.click(screen.getByRole('button', { name: /注册/ }))

    expect(screen.getByText('请填写所有字段')).toBeInTheDocument()
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('密码不一致时显示错误', async () => {
    const user = userEvent.setup()
    const { mockRegister } = renderRegister()

    await user.type(screen.getByLabelText('用户名'), 'testuser')
    await user.type(screen.getByLabelText('邮箱'), 'test@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.type(screen.getByLabelText('确认密码'), 'different123')
    await user.click(screen.getByRole('button', { name: /注册/ }))

    expect(screen.getByText('两次输入的密码不一致')).toBeInTheDocument()
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('密码太短时显示错误', async () => {
    const user = userEvent.setup()
    const { mockRegister } = renderRegister()

    await user.type(screen.getByLabelText('用户名'), 'testuser')
    await user.type(screen.getByLabelText('邮箱'), 'test@example.com')
    await user.type(screen.getByLabelText('密码'), '12345')
    await user.type(screen.getByLabelText('确认密码'), '12345')
    await user.click(screen.getByRole('button', { name: /注册/ }))

    expect(screen.getByText('密码至少 6 个字符')).toBeInTheDocument()
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('填写完整后提交调用 register', async () => {
    const user = userEvent.setup()
    const { mockRegister } = renderRegister()

    mockRegister.mockResolvedValue(undefined)

    await user.type(screen.getByLabelText('用户名'), 'testuser')
    await user.type(screen.getByLabelText('邮箱'), 'test@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.type(screen.getByLabelText('确认密码'), 'password123')
    await user.click(screen.getByRole('button', { name: /注册/ }))

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('testuser', 'test@example.com', 'password123')
    })
  })

  it('register 抛出错误时显示错误消息', async () => {
    const user = userEvent.setup()
    const { mockRegister } = renderRegister()

    mockRegister.mockRejectedValue(new Error('邮箱已被注册'))

    await user.type(screen.getByLabelText('用户名'), 'testuser')
    await user.type(screen.getByLabelText('邮箱'), 'taken@example.com')
    await user.type(screen.getByLabelText('密码'), 'password123')
    await user.type(screen.getByLabelText('确认密码'), 'password123')
    await user.click(screen.getByRole('button', { name: /注册/ }))

    await waitFor(() => {
      expect(screen.getByText('邮箱已被注册')).toBeInTheDocument()
    })
  })
})
