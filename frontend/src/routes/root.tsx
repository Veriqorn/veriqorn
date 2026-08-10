import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'

import { isApiError } from '@/lib/api'
import type { AppRouterContext } from '@/router/context'

export const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: RootLayout,
  errorComponent: RootErrorState,
  notFoundComponent: RootNotFoundState,
})

function RootLayout() {
  return <Outlet />
}

function RootErrorState({ error }: { error: Error }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl rounded-[32px] border border-[rgb(var(--app-line))] bg-white/90 p-8 text-[rgb(var(--app-ink))] shadow-[0_32px_100px_rgba(22,29,42,0.14)]">
        <div className="flex items-center gap-3 text-[rgb(var(--app-accent))]">
          <AlertTriangle className="h-5 w-5" />
          <p className="text-xs font-semibold uppercase tracking-[0.28em]">Something went wrong</p>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">An error occurred.</h1>
        <p className="mt-3 text-sm leading-7 text-[rgb(var(--app-muted))]">
          {isApiError(error)
            ? `HTTP ${error.status} from ${error.url}`
            : error.message || 'An unexpected error occurred. Please try reloading.'}
        </p>
        <pre className="mt-6 overflow-x-auto rounded-3xl bg-[rgb(var(--app-shell))] px-4 py-4 text-sm text-white/90">{error.message}</pre>
        <div className="mt-6 flex gap-3">
          <button
            className="rounded-full bg-[rgb(var(--app-accent))] px-4 py-2 text-sm font-medium text-white transition hover:bg-[rgb(var(--app-accent-strong))]"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload route
          </button>
          <Link
            className="rounded-full border border-[rgb(var(--app-line))] px-4 py-2 text-sm font-medium text-[rgb(var(--app-ink))] transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))]"
            to="/"
          >
            Return home
          </Link>
        </div>
      </div>
    </div>
  )
}

function RootNotFoundState() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl rounded-[32px] border border-[rgb(var(--app-line))] bg-white/90 p-8 text-[rgb(var(--app-ink))] shadow-[0_32px_100px_rgba(22,29,42,0.14)]">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[rgb(var(--app-muted))]">Not found</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Page not found.</h1>
        <p className="mt-3 text-sm leading-7 text-[rgb(var(--app-muted))]">
          The page you are looking for does not exist.
        </p>
        <Link
          className="mt-6 inline-flex rounded-full bg-[rgb(var(--app-accent))] px-4 py-2 text-sm font-medium text-white transition hover:bg-[rgb(var(--app-accent-strong))]"
          to="/"
        >
          Back to active project
        </Link>
      </div>
    </div>
  )
}
