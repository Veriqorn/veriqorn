import { createRoute, redirect } from '@tanstack/react-router'

import { env } from '@/lib/env'
import { buildProjectDashboardPath, resolveStoredProjectId } from '@/lib/project-paths'
import { resolveCanonicalProjectId } from '@/lib/queries'
import { rootRoute } from '@/routes/root'

export const homeRoute = createRoute({
  beforeLoad: async ({ context }) => {
    const auth = await context.auth.ensureInitialized()

    if (auth.status !== 'authenticated') {
      throw redirect({ to: '/login' })
    }

    if (auth.user?.role === 'kb_viewer') {
      throw redirect({ href: env.kbUrl })
    }

    const projectId = await resolveCanonicalProjectId({
      apiClient: context.apiClient,
      preferredProjectId: resolveStoredProjectId(),
      queryClient: context.queryClient,
    })

    throw redirect({ href: buildProjectDashboardPath(projectId) })
  },
  component: () => (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="surface-panel max-w-xl p-8 text-center">
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Redirecting…</h1>
      </div>
    </div>
  ),
  getParentRoute: () => rootRoute,
  path: '/',
})
