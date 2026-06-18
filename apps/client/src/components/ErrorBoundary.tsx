import type { ComponentType, ReactNode } from 'react'
import { Component } from 'react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ComponentType<{ error: Error, reset: () => void }>
}

interface ErrorBoundaryState {
  error: Error | null
}

/** 上报错误到 server 日志 */
function reportError(error: Error) {
  try {
    const payload = {
      message: error.message,
      stack: error.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
    }
    // 使用 fetch 而非 Eden treaty（错误上报不应依赖 API client 的正常工作）
    fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      // 上报本身失败不产生二次错误
    })
  }
  catch {
    // 安全兜底
  }
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    reportError(error)
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return <this.props.fallback error={this.state.error} reset={this.reset} />
      }
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8 min-h-50">
          <p className="text-sm text-destructive font-medium">页面发生错误</p>
          <p className="text-xs text-muted-foreground max-w-md">{this.state.error.message}</p>
          <Button variant="outline" size="sm" onClick={this.reset}>
            重试
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
