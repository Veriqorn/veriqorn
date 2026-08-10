import { createRoute, redirect } from '@tanstack/react-router'

import { AppShell } from '@/components/AppShell'
import { Spinner } from '@/components/ui/spinner'
import { env } from '@/lib/env'
import { rootRoute } from '@/routes/root'

export const authedRoute = createRoute({
  beforeLoad: async ({ context, location }) => {
    const auth = await context.auth.ensureInitialized()

    if (auth.status !== 'authenticated') {
      const redirectPath = `${location.pathname}${location.searchStr ? `?${location.searchStr}` : ''}`

      throw redirect({
        search: { redirectTo: redirectPath },
        to: '/login',
      })
    }

    if (auth.user?.role === 'kb_viewer') {
      throw redirect({ href: env.kbUrl })
    }
  },
  component: AppShell,
  getParentRoute: () => rootRoute,
  id: 'authed',
  pendingComponent: () => (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="surface-panel flex items-center gap-3 px-5 py-4 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4 text-primary" />
        Loading…
      </div>
    </div>
  ),
})
