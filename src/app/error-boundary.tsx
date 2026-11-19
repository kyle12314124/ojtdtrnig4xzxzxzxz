import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Last-resort boundary so a rendering failure never leaves a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="bg-canvas flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <div className="bg-danger-50 text-danger-600 flex size-12 items-center justify-center rounded-full">
          <AlertTriangle className="size-6" aria-hidden />
        </div>
        <h1 className="text-ink-900 mt-4 text-xl font-semibold">Something went wrong</h1>
        <p className="text-ink-500 mt-2 max-w-md text-sm">
          The interface encountered an unexpected error. Reloading usually resolves it. If the
          problem continues, contact your administrator.
        </p>
        <pre className="bg-ink-900 text-ink-100 mt-4 max-h-32 max-w-lg overflow-auto rounded-lg p-3 text-left text-[11px]">
          {this.state.error.message}
        </pre>
        <Button className="mt-5" onClick={() => window.location.reload()}>
          Reload application
        </Button>
      </div>
    )
  }
}
