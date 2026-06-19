import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Skeleton } from './components/ui/skeleton'
import { Toaster } from './components/ui/sonner'

const Admin = lazy(() => import('./pages/Admin'))
const Login = lazy(() => import('./pages/Login'))

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Skeleton className="h-6 w-32" />
    </div>
  )
}

/**
 * 管理端路由：登录页（公开）+ 根控制台（受保护）。
 * 管理员授权由服务端 ADMIN_USER_IDS 守卫；非管理员访问根路由时，
 * Admin shell 内的 overview 请求会 403 并渲染无权访问提示。
 */
export default function App() {
  return (
    <>
      <Toaster richColors position="bottom-right" />
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Admin />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </>
  )
}
