import { lazy, Suspense, useEffect } from 'react'
import { Link, Route, Routes } from 'react-router'
import { sseClient } from './api/sse'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toaster } from './components/ui/sonner'
import { useRealtimeSync } from './stores/realtime-sync'

const Assets = lazy(() => import('./pages/Assets'))
const Admin = lazy(() => import('./pages/Admin'))
const ApiKeys = lazy(() => import('./pages/ApiKeys'))
const Billing = lazy(() => import('./pages/Billing'))
const Developers = lazy(() => import('./pages/Developers'))
const ModelLab = lazy(() => import('./pages/ModelLab'))
const Canvas = lazy(() => import('./pages/Canvas'))
const CanvasEditor = lazy(() => import('./pages/CanvasEditor'))
const Layout = lazy(() => import('./pages/Layout'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const Subtitle = lazy(() => import('./pages/Subtitle'))
const SubtitleEditor = lazy(() => import('./pages/SubtitleEditor'))
const Workspace = lazy(() => import('./pages/Workspace'))

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      页面加载中...
    </div>
  )
}

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-4xl font-bold text-muted-foreground">404</h1>
      <p className="text-muted-foreground">页面不存在</p>
      <Link to="/" className="text-sm text-primary underline underline-offset-4 hover:no-underline">
        返回首页
      </Link>
    </div>
  )
}

function App() {
  // SSE 连接生命周期由 AuthProvider 和 setAuthToken 管理，此处仅负责清理
  useEffect(() => {
    const unsubRealtime = useRealtimeSync.getState().initialize()
    return () => {
      unsubRealtime()
      sseClient.disconnect()
    }
  }, [])

  return (
    <>
      <Toaster richColors position="top-center" />
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route element={<Layout />}>
              <Route element={<ProtectedRoute />}>
                <Route path="/" element={<Workspace />} />
                <Route path="/canvas" element={<Canvas />} />
                <Route path="/canvas/:projectId" element={<CanvasEditor />} />
                <Route path="/subtitle" element={<Subtitle />} />
                <Route path="/subtitle/:id" element={<SubtitleEditor />} />
                <Route path="/assets" element={<Assets />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/api-keys" element={<ApiKeys />} />
                <Route path="/developers" element={<Developers />} />
                <Route path="/model-lab" element={<ModelLab />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </>
  )
}

export default App
