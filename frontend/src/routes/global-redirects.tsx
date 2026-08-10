import { createRoute, redirect } from '@tanstack/react-router'

import {
  buildProjectDashboardPath,
  buildProjectLaunchDetailPath,
  buildProjectLaunchesPath,
  resolveStoredProjectId,
} from '@/lib/project-paths'
import { resolveCanonicalProjectId } from '@/lib/queries'
import { authedRoute } from '@/routes/authed'

const resolveActiveProjectId = async ({ context }: { context: { apiClient: unknown; queryClient: unknown } }) => {
  return resolveCanonicalProjectId({
    apiClient: context.apiClient as Parameters<typeof resolveCanonicalProjectId>[0]['apiClient'],
    preferredProjectId: resolveStoredProjectId(),
    queryClient: context.queryClient as Parameters<typeof resolveCanonicalProjectId>[0]['queryClient'],
  })
}

const RedirectingStub = () => (
  <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">Redirecting…</div>
)

export const globalDashboardRoute = createRoute({
  beforeLoad: async (ctx) => {
    const projectId = await resolveActiveProjectId(ctx)
    throw redirect({ href: buildProjectDashboardPath(projectId) })
  },
  component: RedirectingStub,
  getParentRoute: () => authedRoute,
  path: 'dashboard',
})

export const globalLaunchesRoute = createRoute({
  beforeLoad: async (ctx) => {
    const projectId = await resolveActiveProjectId(ctx)
    throw redirect({ href: buildProjectLaunchesPath(projectId) })
  },
  component: RedirectingStub,
  getParentRoute: () => authedRoute,
  path: 'launches',
})

export const globalLaunchDetailRoute = createRoute({
  beforeLoad: async (ctx) => {
    const projectId = await resolveActiveProjectId(ctx)
    const launchId = (ctx.params as { launchId?: string }).launchId ?? ''
    throw redirect({ href: buildProjectLaunchDetailPath(projectId, launchId) })
  },
  component: RedirectingStub,
  getParentRoute: () => authedRoute,
  path: 'launches/$launchId',
})
