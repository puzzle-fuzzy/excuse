import type { AuthUser } from '@excuse/shared'
import type { ReactNode } from 'react'
import type { AuthContextValue } from './AuthContext'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  fetchCurrentUser,
  loginRequest,
  logoutRequest,
  setAuthToken,
} from '../api/client'
import { AuthContext } from './AuthContext'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

  // 挂载时：通过 httpOnly cookie 自动认证（无需 localStorage）
  // 管理端不使用 SSE，故无连接生命周期。
  useEffect(() => {
    fetchCurrentUser()
      .then((res) => {
        if (res.success) {
          setUser(res.data)
        }
      })
      .catch(() => {
        // cookie 无效或过期 — 未登录状态
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginRequest(email, password)
    setAuthToken(res.data.token)
    setUser(res.data.user)
  }, [])

  // 监听 unwrapEden 发出的 401/403 未授权事件 → 强制登出
  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null)
      navigate('/login')
    }
    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized)
  }, [navigate])

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    }
    catch {
      // 服务端清除失败不阻塞本地登出
    }
    setAuthToken(null)
    setUser(null)
    navigate('/login')
  }, [navigate])

  const value: AuthContextValue = {
    user,
    isLoading,
    login,
    register: async () => {
      throw new Error('管理后台不支持自助注册')
    },
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
