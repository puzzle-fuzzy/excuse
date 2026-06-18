import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { queryClient } from './api/query-client'
import { reportWebVitals } from './lib/web-vitals'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import './index.css'

// 启动 Web Vitals 性能监控（非阻塞，PerformanceObserver 回调异步上报）
reportWebVitals()

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </BrowserRouter>,
)
