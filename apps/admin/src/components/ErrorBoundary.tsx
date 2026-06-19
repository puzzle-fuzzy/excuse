import type { ComponentType, ReactNode } from 'react'
import { Component } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /** 自定义 fallback 组件，接收重置函数 */
  fallback?: ComponentType<{ reset: () => void }>
}

interface State {
  hasError: boolean
}

/**
 * 管理端顶层错误边界。与用户端版本一致，但不做前端错误回传（运营内部工具）。
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: Error) {
    console.error('[admin] Uncaught error', error)
  }

  reset = () => {
    this.setState({ hasError: false })
  }

  override render() {
    if (this.state.hasError) {
      const Fallback = this.props.fallback
      if (Fallback)
        return <Fallback reset={this.reset} />

      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">页面出错了</h1>
          <p className="text-muted-foreground">发生了未知错误，请重试或刷新页面。</p>
          <Button onClick={this.reset}>重试</Button>
        </div>
      )
    }
    return this.props.children
  }
}
