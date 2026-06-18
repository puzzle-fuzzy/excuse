import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { queryClient } from './api/query-client'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { ThemeProvider } from './components/theme-provider'
import { reportWebVitals } from './lib/web-vitals'
import './index.css'

// 启动 Web Vitals 性能监控（非阻塞，PerformanceObserver 回调异步上报）
reportWebVitals()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)
