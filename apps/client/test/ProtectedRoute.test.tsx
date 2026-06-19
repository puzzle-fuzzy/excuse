import type { AuthContextValue } from '../src/auth/AuthContext'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { AuthContext } from '../src/auth/AuthContext'
import { ProtectedRoute } from '../src/auth/ProtectedRoute'

function renderProtectedRoute(authValue: Partial<AuthContextValue>) {
  const defaultValue: AuthContextValue = {
    user: null,
    isLoading: false,
    login: async () => {},
    register: async () => {},
    logout: () => {},
    ...authValue,
  }

  return render(
    <AuthContext.Provider value={defaultValue}>
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div data-testid="login-page">Login Page</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/protected" element={<div data-testid="protected-content">Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('protectedRoute', () => {
  it('用户已登录时渲染子路由', () => {
    renderProtectedRoute({
      user: { id: '1', username: 'testuser', email: 'test@test.com', isActive: true, createdAt: '', updatedAt: '' },
      isLoading: false,
    })

    expect(screen.getByTestId('protected-content')).toBeInTheDocument()
  })

  it('用户未登录时重定向到 /login', () => {
    renderProtectedRoute({
      user: null,
      isLoading: false,
    })

    expect(screen.getByTestId('login-page')).toBeInTheDocument()
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
  })

  it('加载中时显示 loading spinner', () => {
    const { container } = renderProtectedRoute({
      user: null,
      isLoading: true,
    })

    // Loader2 svg should be present
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
  })
})
