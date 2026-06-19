import type { ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthContext, useAuth } from '../src/auth/AuthContext'

describe('useAuth', () => {
  it('在 AuthProvider 内使用时返回 context 值', () => {
    const mockValue = {
      user: { id: '1', username: 'test', email: 'test@test.com', isActive: true, createdAt: '', updatedAt: '' },
      isLoading: false,
      login: async () => {},
      register: async () => {},
      logout: () => {},
    }

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthContext.Provider value={mockValue}>{children}</AuthContext.Provider>
    )

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current).toBe(mockValue)
    expect(result.current.user).toEqual(mockValue.user)
  })

  it('在 AuthProvider 外使用时抛出错误', () => {
    // suppress console.error from React
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within an AuthProvider',
    )

    spy.mockRestore()
  })
})
