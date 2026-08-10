import type { ReactNode } from 'react'
import React from 'react'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public constructor(props: AppErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  public static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('frontend render error', error, errorInfo)
  }

  private handleReset = () => {
    this.setState({ error: null })
  }

  public render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[rgb(var(--app-surface))] px-6 py-12">
        <div className="w-full max-w-lg rounded-[28px] border border-[rgb(var(--app-line))] bg-white/90 p-8 shadow-[0_32px_100px_rgba(22,29,42,0.14)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[rgb(var(--app-accent))]">
            Frontend-v2 bootstrap error
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-[rgb(var(--app-ink))]">Something broke during render.</h1>
          <p className="mt-3 text-sm leading-6 text-[rgb(var(--app-muted))]">
            The new foundation wraps the whole application in a single error boundary so provider or route failures land in one recoverable place.
          </p>
          <pre className="mt-6 overflow-x-auto rounded-2xl bg-[rgb(var(--app-shell))] px-4 py-3 text-sm text-white/90">
            {this.state.error.message}
          </pre>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="rounded-full bg-[rgb(var(--app-accent))] px-4 py-2 text-sm font-medium text-white transition hover:bg-[rgb(var(--app-accent-strong))]"
              onClick={this.handleReset}
              type="button"
            >
              Reset boundary
            </button>
            <button
              className="rounded-full border border-[rgb(var(--app-line))] px-4 py-2 text-sm font-medium text-[rgb(var(--app-ink))] transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))]"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload application
            </button>
          </div>
        </div>
      </div>
    )
  }
}
