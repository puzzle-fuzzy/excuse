import type { AuthUser } from '@excuse/shared'
import { createContext, useContext } from 'react'

export interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

/**
 * 获取当前认证状态
 * 必须在 AuthProvider 内使用
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
