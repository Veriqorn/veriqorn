import { useQuery } from '@tanstack/react-query'
import { createRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import {
  getProjectLaunchQueryOptions,
  getProjectLaunchResultsQueryOptions,
} from '@/lib/queries'
import { useRuntime } from '@/providers/runtime-provider'
import { projectLayoutRoute } from '@/routes/project-layout'
import { LaunchResultsExplorer } from '@/routes/project-results-explorer'
import { validateTestResultsSearch } from '@/router/search'

export const projectTestResultsRoute = createRoute({
  component: ProjectTestResultsPage,
  getParentRoute: () => projectLayoutRoute,
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(getProjectLaunchQueryOptions(context.apiClient, params.projectId, params.launchId)),
      context.queryClient.ensureQueryData(
        getProjectLaunchResultsQueryOptions(context.apiClient, params.projectId, params.launchId),
      ),
    ])
  },
  path: 'launches/$launchId/results',
  validateSearch: validateTestResultsSearch,
})

function ProjectTestResultsPage() {
  const navigate = projectTestResultsRoute.useNavigate()
  const { apiClient } = useRuntime()
  const { launchId, projectId } = projectTestResultsRoute.useParams()
  const search = projectTestResultsRoute.useSearch()

  const launchQuery = useQuery(getProjectLaunchQueryOptions(apiClient, projectId, launchId))
  const resultsQuery = useQuery(getProjectLaunchResultsQueryOptions(apiClient, projectId, launchId))

  const launch = launchQuery.data
  const resultsResponse = resultsQuery.data

  const setTab = (tab: typeof search.tab) => {
    void navigate({
      params: { launchId, projectId },
      search: {
        resultId: search.resultId,
        tab,
      },
      to: '/projects/$projectId/launches/$launchId/results',
    })
  }

  const focusResult = (resultId: string) => {
    void navigate({
      params: { launchId, projectId },
      search: {
        resultId,
        tab: search.tab,
      },
      to: '/projects/$projectId/launches/$launchId/results',
    })
  }

  if (launchQuery.isLoading || resultsQuery.isLoading) {
    return (
      <div className="rounded-[28px] border border-[rgb(var(--app-line))] bg-white/90 px-6 py-8 text-sm text-[rgb(var(--app-muted))] shadow-[0_20px_55px_rgba(22,29,42,0.07)]">
        Loading test results...
      </div>
    )
  }

  if (!launch || !resultsResponse || launchQuery.error || resultsQuery.error) {
    return (
      <div className="rounded-[28px] border border-red-200 bg-red-50/80 px-6 py-6 text-sm leading-7 text-red-900 shadow-[0_20px_55px_rgba(22,29,42,0.07)]">
        Test results could not be loaded. Please go back and try again.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_24px_70px_rgba(22,29,42,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[rgb(var(--app-ink))]">{launch.name}</h1>
          </div>

          <Link
            className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--app-line))] px-4 py-2 text-sm font-medium text-[rgb(var(--app-ink))] transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))]"
            params={{ launchId, projectId }}
            search={{ resultId: search.resultId, tab: 'overview' }}
            to="/projects/$projectId/launches/$launchId"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to launch
          </Link>
        </div>
      </section>

      <LaunchResultsExplorer
        launchId={launchId}
        onSelectResult={focusResult}
        onTabChange={setTab}
        projectId={projectId}
        resultsResponse={resultsResponse}
        search={search}
      />
    </div>
  )
}
