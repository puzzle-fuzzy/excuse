import { Loader2 } from 'lucide-react'
import { Navigate, Outlet } from 'react-router'
import { useAuth } from './AuthContext'

/**
 * 路由守卫 — 未登录时重定向到 /login
 *
 * 用法：<Route element={<ProtectedRoute />}><Route ... /></Route>
 */
export function ProtectedRoute() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
