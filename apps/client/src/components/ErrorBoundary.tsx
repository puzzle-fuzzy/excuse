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

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
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
