import { createRoute, Outlet, redirect } from '@tanstack/react-router'

import { Spinner } from '@/components/ui/spinner'
import { buildProjectDashboardPath, normalizeProjectId, resolveStoredProjectId } from '@/lib/project-paths'
import { getProjectsQueryOptions, resolveCanonicalProjectId } from '@/lib/queries'
import { authedRoute } from '@/routes/authed'

export const projectLayoutRoute = createRoute({
  beforeLoad: async ({ context, params }) => {
    const projects = await context.queryClient.ensureQueryData(getProjectsQueryOptions(context.apiClient))

    if (projects.length === 0) {
      return
    }

    const normalizedProjectId = normalizeProjectId(params.projectId)
    const projectExists = projects.some(
      (project) => !project.isArchived && normalizeProjectId(project.id) === normalizedProjectId,
    )

    if (!projectExists) {
      const fallbackProjectId = await resolveCanonicalProjectId({
        apiClient: context.apiClient,
        preferredProjectId: resolveStoredProjectId(),
        queryClient: context.queryClient,
      })

      throw redirect({ href: buildProjectDashboardPath(fallbackProjectId) })
    }
  },
  component: () => <Outlet />,
  getParentRoute: () => authedRoute,
  path: 'projects/$projectId',
  pendingComponent: () => (
    <div className="surface-panel flex items-center gap-3 px-5 py-4 text-sm text-muted-foreground">
      <Spinner className="h-4 w-4 text-primary" />
      Loading project…
    </div>
  ),
})
