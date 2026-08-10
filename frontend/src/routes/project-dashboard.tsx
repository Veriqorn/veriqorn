import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRoute, Link } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Clock,
  Filter,
  Pencil,
  Plus,
  RefreshCcw,
  Settings2,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { isApiError, unwrapApiData } from '@/lib/api'
import { normalizeDateInputToSearchValue, searchValueToDateInput } from '@/lib/date-search'
import {
  getProjectDashboardMetaQueryOptions,
  getProjectDashboardMetricsQueryOptions,
  getProjectDashboardsQueryOptions,
  getProjectRecentLaunchesQueryOptions,
  queryKeys,
} from '@/lib/queries'
import { useRuntime } from '@/providers/runtime-provider'
import { projectLayoutRoute } from '@/routes/project-layout'
import { defaultDashboardSearch, validateDashboardSearch } from '@/router/search'
import type {
  DashboardConfig,
  DashboardMetricsResponse,
  DashboardWidget,
  DashboardWidgetLayout,
  TestRun,
} from '@/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type DashboardSourceId =
  | 'flaky-rate'
  | 'latest-run-status'
  | 'pass-fail-trend'
  | 'pass-rate'
  | 'recent-runs'
  | 'test-summary'
  | 'test-trend'
  | 'top-failing-suites'
  | 'top-failing-tests'

type WidgetOption = {
  description: string
  id: string
  label: string
  visualization: string
}

type WidgetViewport = 'compact' | 'medium' | 'wide'

const createId = () => Math.random().toString(36).slice(2, 10)

const dataSourceDefaults: Record<DashboardSourceId, WidgetOption> = {
  'flaky-rate': {
    description: 'Share of tests that switch between pass and fail states.',
    id: 'flaky-rate',
    label: 'Flaky Rate',
    visualization: 'stat',
  },
  'latest-run-status': {
    description: 'Status summary for the newest run.',
    id: 'latest-run-status',
    label: 'Latest Run Status',
    visualization: 'stat',
  },
  'pass-fail-trend': {
    description: 'Trend of passed and failed tests across selected launches.',
    id: 'pass-fail-trend',
    label: 'Pass/Fail Trend',
    visualization: 'line',
  },
  'pass-rate': {
    description: 'Overall pass rate for the project.',
    id: 'pass-rate',
    label: 'Pass Rate',
    visualization: 'pie',
  },
  'recent-runs': {
    description: 'Latest launches with status and timing.',
    id: 'recent-runs',
    label: 'Recent Runs',
    visualization: 'table',
  },
  'test-summary': {
    description: 'High-level pass/fail totals across tests.',
    id: 'test-summary',
    label: 'Test Summary',
    visualization: 'stat',
  },
  'test-trend': {
    description: 'Pass/fail trends across recent launches.',
    id: 'test-trend',
    label: 'Test Trend',
    visualization: 'line',
  },
  'top-failing-suites': {
    description: 'Suites with most failures in selected scope.',
    id: 'top-failing-suites',
    label: 'Top Failing Suites',
    visualization: 'table',
  },
  'top-failing-tests': {
    description: 'Tests with highest failure count in selected scope.',
    id: 'top-failing-tests',
    label: 'Top Failing Tests',
    visualization: 'table',
  },
}

const defaultWidgetSources: DashboardSourceId[] = [
  'test-summary',
  'pass-fail-trend',
  'flaky-rate',
  'top-failing-tests',
  'top-failing-suites',
]

const widgetSizePresets: Array<{
  h: number
  key: 'l' | 'm' | 's' | 'xl'
  label: string
  w: number
}> = [
  { h: 1, key: 's', label: 'S', w: 8 },
  { h: 2, key: 'm', label: 'M', w: 12 },
  { h: 2, key: 'l', label: 'L', w: 16 },
  { h: 3, key: 'xl', label: 'XL', w: 24 },
]

const buildLayout = (index: number, preset: (typeof widgetSizePresets)[number] = widgetSizePresets[1]): DashboardWidgetLayout => ({
  h: preset.h,
  w: preset.w,
  x: 0,
  y: index,
})

const widgetMinimumSizeBySource: Record<string, { h: number; w: number }> = {
  'flaky-rate': { h: 2, w: 8 },
  'latest-run-status': { h: 2, w: 8 },
  'pass-fail-trend': { h: 3, w: 12 },
  'pass-rate': { h: 2, w: 8 },
  'recent-runs': { h: 3, w: 12 },
  'test-summary': { h: 3, w: 10 },
  'test-trend': { h: 3, w: 12 },
  'top-failing-suites': { h: 3, w: 12 },
  'top-failing-tests': { h: 3, w: 12 },
}

const buildDefaultWidgets = (): DashboardWidget[] =>
  defaultWidgetSources.map((source, index) => ({
    dataSource: source,
    id: createId(),
    layout: buildLayout(index),
    title: dataSourceDefaults[source].label,
    visualization: dataSourceDefaults[source].visualization,
  }))

export const projectDashboardRoute = createRoute({
  component: ProjectDashboardPage,
  getParentRoute: () => projectLayoutRoute,
  loader: async ({ context, deps, params }) => {
    const search = validateDashboardSearch(deps)
    await Promise.all([
      context.queryClient.ensureQueryData(getProjectDashboardsQueryOptions(context.apiClient, params.projectId)),
      context.queryClient.ensureQueryData(getProjectDashboardMetricsQueryOptions(context.apiClient, params.projectId, search)),
      context.queryClient.ensureQueryData(getProjectDashboardMetaQueryOptions(context.apiClient, params.projectId)),
      context.queryClient.ensureQueryData(getProjectRecentLaunchesQueryOptions(context.apiClient, params.projectId, search.status)),
    ])
  },
  loaderDeps: ({ search }): ReturnType<typeof validateDashboardSearch> => validateDashboardSearch(search),
  path: 'dashboard',
  validateSearch: validateDashboardSearch,
})

function ProjectDashboardPage() {
  const navigate = projectDashboardRoute.useNavigate()
  const queryClient = useQueryClient()
  const { apiClient } = useRuntime()
  const { projectId } = projectDashboardRoute.useParams()
  const search = projectDashboardRoute.useSearch()
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null)
  const [dashboardNameDraft, setDashboardNameDraft] = useState<{ dashboardId: null | string; value: string }>({ dashboardId: null, value: '' })
  const [dashboardSettingsOpen, setDashboardSettingsOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [editingDashboardId, setEditingDashboardId] = useState<string | null>(null)
  const [pageMessage, setPageMessage] = useState<null | { tone: 'error' | 'success'; value: string }>(null)
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false)
  const [draftWidgets, setDraftWidgets] = useState<DashboardWidget[]>([])
  const [activeResizeWidgetId, setActiveResizeWidgetId] = useState<string | null>(null)
  const [activeDragWidgetId, setActiveDragWidgetId] = useState<string | null>(null)
  const [dragOverWidgetId, setDragOverWidgetId] = useState<string | null>(null)
  const resizeSessionRef = useRef<null | {
    minimumHeight: number
    minimumWidth: number
    mode: 'both' | 'height' | 'width'
    startHeight: number
    startWidth: number
    widgetId: string
    x: number
    y: number
  }>(null)

  const dashboardsQuery = useQuery(getProjectDashboardsQueryOptions(apiClient, projectId))
  const metricsQuery = useQuery(getProjectDashboardMetricsQueryOptions(apiClient, projectId, search))
  const metaQuery = useQuery(getProjectDashboardMetaQueryOptions(apiClient, projectId))
  const recentRunsQuery = useQuery(getProjectRecentLaunchesQueryOptions(apiClient, projectId, search.status))

  useEffect(() => {
    if (!search.refresh || metricsQuery.isFetching) {
      return
    }

    void navigate({
      params: { projectId },
      replace: true,
      search: {
        ...search,
        refresh: false,
      },
      to: '/projects/$projectId/dashboard',
    })
  }, [metricsQuery.isFetching, navigate, projectId, search])

  const dashboards = useMemo(() => {
    const items = dashboardsQuery.data?.dashboards ?? []
    return [...items].sort((left, right) => left.order - right.order)
  }, [dashboardsQuery.data?.dashboards])

  const activeDashboardId = useMemo(() => {
    if (dashboards.length === 0) {
      return null
    }

    if (selectedDashboardId && dashboards.some((dashboard) => dashboard.id === selectedDashboardId)) {
      return selectedDashboardId
    }

    return dashboards.find((dashboard) => dashboard.isDefault)?.id ?? dashboards[0]?.id ?? null
  }, [dashboards, selectedDashboardId])

  const activeDashboard = useMemo(
    () => dashboards.find((dashboard) => dashboard.id === activeDashboardId) ?? null,
    [activeDashboardId, dashboards],
  )

  const dashboardNameInput =
    dashboardNameDraft.dashboardId === activeDashboard?.id
      ? dashboardNameDraft.value
      : activeDashboard?.name ?? ''

  const handleDashboardNameInputChange = (value: string) => {
    setDashboardNameDraft({ dashboardId: activeDashboard?.id ?? null, value })
  }

  const isEditMode = editingDashboardId === activeDashboard?.id

  const metrics = metricsQuery.data
  const recentRuns = recentRunsQuery.data ?? []
  const widgetOptions = useMemo(() => {
    const metaOptions = metaQuery.data?.dataSources ?? []

    if (metaOptions.length === 0) {
      return Object.values(dataSourceDefaults)
    }

    return metaOptions.map((option) => {
      const defaults = dataSourceDefaults[option.id as DashboardSourceId]
      return {
        description: defaults?.description ?? 'Custom dashboard data source.',
        id: option.id,
        label: option.label,
        visualization: defaults?.visualization ?? 'stat',
      }
    })
  }, [metaQuery.data?.dataSources])

  const orderedWidgets = useMemo(
    () => (isEditMode ? draftWidgets : activeDashboard?.widgets ?? []),
    [activeDashboard?.widgets, draftWidgets, isEditMode],
  )

  const activeFilterCount =
    (search.branch ? 1 : 0) +
    (search.dateFrom ? 1 : 0) +
    (search.dateTo ? 1 : 0) +
    (search.environment ? 1 : 0) +
    (search.status ? 1 : 0) +
    (search.tags ? 1 : 0)

  const filterPanelKey = [
    search.branch ?? '',
    search.dateFrom ?? '',
    search.dateTo ?? '',
    search.environment ?? '',
    search.status ?? '',
    search.tags ?? '',
  ].join('|')

  const summaryCards = [
    {
      description: 'Scoped to the current dashboard filters.',
      label: 'Visible runs',
      value: metrics ? String(metrics.summary.totalRuns) : '--',
    },
    {
      description: 'Total test results represented in the dashboard widgets.',
      label: 'Visible tests',
      value: metrics ? String(metrics.summary.totalTests) : '--',
    },
    {
      description: 'Current aggregated pass rate.',
      label: 'Pass rate',
      value: metrics ? `${metrics.summary.passRate}%` : '--',
    },
    {
      description: 'Share of tracked tests that behave inconsistently.',
      label: 'Flaky rate',
      value: metrics ? `${metrics.flakyRate.percentage}%` : '--',
    },
  ]

  const triggerForceRefresh = () => {
    setPageMessage(null)
    void navigate({
      params: { projectId },
      search: {
        ...search,
        refresh: true,
      },
      to: '/projects/$projectId/dashboard',
    })
  }

  const invalidateDashboardQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.projectDashboard(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectDashboards(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectDashboardMetrics(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectLaunches(projectId) }),
    ])
  }

  const updateDashboard = async (dashboardId: string, updates: Partial<DashboardConfig>) => {
    await apiClient.put(`/api/v1/projects/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(dashboardId)}`, updates)
    await invalidateDashboardQueries()
  }

  const createDashboardMutation = useMutation({
    mutationFn: async () => {
      const payload = await apiClient.post<unknown>(`/api/v1/projects/${encodeURIComponent(projectId)}/dashboards`, {
        name: `Dashboard ${dashboards.length + 1}`,
        widgets: buildDefaultWidgets(),
      })

      return unwrapApiData(payload) as { dashboard?: { id?: string } }
    },
    onError: (error) => {
      setPageMessage({ tone: 'error', value: resolveErrorMessage(error, 'Failed to create dashboard.') })
    },
    onSuccess: async (result) => {
      await invalidateDashboardQueries()
      setDashboardSettingsOpen(false)
      setPageMessage({ tone: 'success', value: 'New dashboard created.' })
      if (result.dashboard?.id) {
        setSelectedDashboardId(result.dashboard.id)
      }
    },
  })

  const renameDashboardMutation = useMutation({
    mutationFn: async () => {
      if (!activeDashboard) {
        throw new Error('No active dashboard selected.')
      }

      await updateDashboard(activeDashboard.id, { name: dashboardNameInput.trim() })
    },
    onError: (error) => {
      setPageMessage({ tone: 'error', value: resolveErrorMessage(error, 'Failed to rename dashboard.') })
    },
    onSuccess: () => {
      setDashboardSettingsOpen(false)
      setPageMessage({ tone: 'success', value: 'Dashboard name updated.' })
    },
  })

  const setDefaultDashboardMutation = useMutation({
    mutationFn: async () => {
      if (!activeDashboard) {
        throw new Error('No active dashboard selected.')
      }

      await updateDashboard(activeDashboard.id, { isDefault: true })
    },
    onError: (error) => {
      setPageMessage({ tone: 'error', value: resolveErrorMessage(error, 'Failed to set default dashboard.') })
    },
    onSuccess: () => {
      setPageMessage({ tone: 'success', value: 'Dashboard marked as default.' })
    },
  })

  const deleteDashboardMutation = useMutation({
    mutationFn: async () => {
      if (!activeDashboard) {
        throw new Error('No active dashboard selected.')
      }

      await apiClient.delete(`/api/v1/projects/${encodeURIComponent(projectId)}/dashboards/${encodeURIComponent(activeDashboard.id)}`)
      await invalidateDashboardQueries()
    },
    onError: (error) => {
      setPageMessage({ tone: 'error', value: resolveErrorMessage(error, 'Failed to delete dashboard.') })
    },
    onSuccess: () => {
      setDashboardSettingsOpen(false)
      setPageMessage({ tone: 'success', value: 'Dashboard deleted.' })
      setSelectedDashboardId(null)
    },
  })

  const updateWidgetsMutation = useMutation({
    mutationFn: async (widgets: DashboardWidget[]) => {
      if (!activeDashboard) {
        throw new Error('No active dashboard selected.')
      }

      await updateDashboard(activeDashboard.id, { widgets })
    },
    onError: (error) => {
      setPageMessage({ tone: 'error', value: resolveErrorMessage(error, 'Failed to update widgets.') })
    },
    onSuccess: () => {
      setPageMessage({ tone: 'success', value: 'Dashboard layout updated.' })
    },
  })

  const normalizeWidgetsForDraft = (widgets: DashboardWidget[]) =>
    widgets.map((widget, index) => ({
      ...widget,
      layout: normalizeWidgetLayout(widget.layout, index, widget.dataSource),
    }))

  const persistWidgets = (nextWidgets: DashboardWidget[]) => {
    setPageMessage(null)
    updateWidgetsMutation.mutate(normalizeWidgetsForDraft(nextWidgets))
  }

  const updateDraftWidgets = (updater: (widgets: DashboardWidget[]) => DashboardWidget[]) => {
    setDraftWidgets((current) => normalizeWidgetsForDraft(updater(current)))
  }

  const handleAddWidget = (option: WidgetOption) => {
    if (!activeDashboard || !isEditMode) {
      return
    }

    const nextWidget: DashboardWidget = {
      dataSource: option.id,
      id: createId(),
      layout: ensureWidgetLayoutForSource(option.id, buildLayout(activeDashboard.widgets.length)),
      title: option.label,
      visualization: option.visualization,
    }

    updateDraftWidgets((current) => [...current, nextWidget])
    setWidgetPickerOpen(false)
  }

  const handleMoveWidget = (widgetId: string, direction: -1 | 1) => {
    if (!activeDashboard || !isEditMode) {
      return
    }

    const currentIndex = draftWidgets.findIndex((widget) => widget.id === widgetId)
    const targetIndex = currentIndex + direction

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= draftWidgets.length) {
      return
    }

    const nextWidgets = [...draftWidgets]
    const [movedWidget] = nextWidgets.splice(currentIndex, 1)
    nextWidgets.splice(targetIndex, 0, movedWidget)
    setDraftWidgets(normalizeWidgetsForDraft(nextWidgets))
  }

  const handleResizeWidget = (
    widgetId: string,
    nextLayout: Partial<Pick<DashboardWidgetLayout, 'h' | 'w'>>,
  ) => {
    if (!activeDashboard || !isEditMode) {
      return
    }

    setDraftWidgets(normalizeWidgetsForDraft(
      draftWidgets.map((widget, index) =>
        widget.id === widgetId
          ? {
              ...widget,
              layout: {
                ...normalizeWidgetLayout(widget.layout, index),
                ...nextLayout,
              },
            }
          : widget,
      ),
    ))
  }

  const handleRemoveWidget = (widgetId: string) => {
    if (!activeDashboard || !isEditMode) {
      return
    }

    updateDraftWidgets((current) => current.filter((widget) => widget.id !== widgetId))
  }

  const handleRestoreDefaultWidgets = () => {
    if (!activeDashboard || !isEditMode) {
      return
    }

    setDraftWidgets(buildDefaultWidgets())
  }

  const handleStartEditing = () => {
    if (!activeDashboard) {
      return
    }

    setDraftWidgets(normalizeWidgetsForDraft(activeDashboard.widgets))
    setEditingDashboardId(activeDashboard.id)
    setPageMessage(null)
  }

  const handleCancelEditing = () => {
    setDraftWidgets(normalizeWidgetsForDraft(activeDashboard?.widgets ?? []))
    setEditingDashboardId(null)
  }

  const handleSaveEditing = () => {
    persistWidgets(draftWidgets)
    setEditingDashboardId(null)
  }

  const handleDropWidget = (sourceWidgetId: string, targetWidgetId: string) => {
    if (!isEditMode || sourceWidgetId === targetWidgetId) {
      return
    }

    const sourceIndex = draftWidgets.findIndex((widget) => widget.id === sourceWidgetId)
    const targetIndex = draftWidgets.findIndex((widget) => widget.id === targetWidgetId)

    if (sourceIndex < 0 || targetIndex < 0) {
      return
    }

    const nextWidgets = [...draftWidgets]
    const [movedWidget] = nextWidgets.splice(sourceIndex, 1)
    nextWidgets.splice(targetIndex, 0, movedWidget)
    setDraftWidgets(normalizeWidgetsForDraft(nextWidgets))
    setDragOverWidgetId(null)
  }

  const handleDragStartWidget = (widgetId: string) => {
    if (!isEditMode) {
      return
    }

    setActiveDragWidgetId(widgetId)
    setDragOverWidgetId(null)
  }

  const handleDragEnterWidget = (sourceWidgetId: string, targetWidgetId: string) => {
    if (!isEditMode || sourceWidgetId === targetWidgetId) {
      return
    }

    setDragOverWidgetId(targetWidgetId)
    setDraftWidgets((current) => {
      const sourceIndex = current.findIndex((widget) => widget.id === sourceWidgetId)
      const targetIndex = current.findIndex((widget) => widget.id === targetWidgetId)

      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return current
      }

      const nextWidgets = [...current]
      const [movedWidget] = nextWidgets.splice(sourceIndex, 1)
      nextWidgets.splice(targetIndex, 0, movedWidget)
      return normalizeWidgetsForDraft(nextWidgets)
    })
  }

  const handleDragEndWidget = () => {
    setActiveDragWidgetId(null)
    setDragOverWidgetId(null)
  }

  const handleResizeStart = (
    event: React.PointerEvent<HTMLButtonElement>,
    widgetId: string,
    mode: 'both' | 'height' | 'width',
  ) => {
    if (!isEditMode) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const widget = draftWidgets.find((item) => item.id === widgetId)
    if (!widget) {
      return
    }

      const layout = normalizeWidgetLayout(widget.layout)
      const minimumSize = getWidgetMinimumSize(widget.dataSource)
      resizeSessionRef.current = {
        minimumHeight: minimumSize.h,
        minimumWidth: minimumSize.w,
        mode,
        startHeight: layout.h,
        startWidth: layout.w,
      widgetId,
      x: event.clientX,
      y: event.clientY,
    }
    setActiveResizeWidgetId(widgetId)

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor =
      mode === 'width' ? 'ew-resize' : mode === 'height' ? 'ns-resize' : 'nwse-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const session = resizeSessionRef.current
      if (!session) {
        return
      }

      if (moveEvent.buttons === 0) {
        stopResize()
        return
      }

      const deltaX = moveEvent.clientX - session.x
      const deltaY = moveEvent.clientY - session.y
      const nextWidth =
        session.mode === 'height'
          ? session.startWidth
          : clamp(Math.round(session.startWidth + deltaX / 28), session.minimumWidth, 24)
      const nextHeight =
        session.mode === 'width'
          ? session.startHeight
          : clamp(Math.round(session.startHeight + deltaY / 32), session.minimumHeight, 8)

      setDraftWidgets((current) =>
        normalizeWidgetsForDraft(
          current.map((item, index) =>
            item.id === session.widgetId
              ? {
                  ...item,
                  layout: {
                    ...normalizeWidgetLayout(item.layout, index),
                    h: nextHeight,
                    w: nextWidth,
                  },
                }
              : item,
          ),
        ),
      )
    }

    function stopResize() {
      resizeSessionRef.current = null
      setActiveResizeWidgetId(null)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResize)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResize)
  }

  const handleApplyFilters = (nextSearch: typeof search) => {
    setPageMessage(null)
    void navigate({
      params: { projectId },
      search: nextSearch,
      to: '/projects/$projectId/dashboard',
    })
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-[0_24px_70px_rgba(22,29,42,0.08)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[rgb(var(--app-ink))]">Overview</h1>
            <p className="mt-1 text-sm text-[rgb(var(--app-muted))]">
              Configure which widgets appear on the dashboard, how large they are, and in what order they render.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setFiltersOpen(true)} size="sm" variant="outline">
              <Filter className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 ? (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>

            {isEditMode ? (
              <>
                <Button disabled={!activeDashboard} onClick={() => setWidgetPickerOpen(true)} size="sm" variant="outline">
                  <Plus className="h-4 w-4" />
                  Add widget
                </Button>
                <Button disabled={updateWidgetsMutation.isPending} onClick={handleCancelEditing} size="sm" variant="outline">
                  Cancel
                </Button>
                <Button disabled={updateWidgetsMutation.isPending} onClick={handleSaveEditing} size="sm">
                  Save layout
                </Button>
                <Button
                  className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                  disabled={!activeDashboard || deleteDashboardMutation.isPending}
                  onClick={() => {
                    if (!activeDashboard || !window.confirm(`Delete dashboard "${activeDashboard.name}"?`)) {
                      return
                    }

                    deleteDashboardMutation.mutate()
                  }}
                  size="sm"
                  variant="outline"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete dashboard
                </Button>
              </>
            ) : (
              <Button disabled={!activeDashboard} onClick={handleStartEditing} size="sm" variant="outline">
                <Pencil className="h-4 w-4" />
                Edit layout
              </Button>
            )}

            <Button onClick={() => setDashboardSettingsOpen(true)} size="sm" variant="outline">
              <Settings2 className="h-4 w-4" />
              Dashboard settings
            </Button>

            <Button asChild size="sm" variant="outline">
              <Link search={{ section: 'projects' }} to="/settings">
                <Settings2 className="h-4 w-4" />
                Project settings
              </Link>
            </Button>

            <Button data-testid="metrics-refresh-force" onClick={triggerForceRefresh} size="sm" variant="outline">
              <RefreshCcw className={search.refresh || metricsQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {summaryCards.map((card) => (
            <SummaryCard
              description={card.description}
              key={card.label}
              label={card.label}
              value={card.value}
            />
          ))}
        </div>
      </section>

      {pageMessage ? (
        <section
          className={
            pageMessage.tone === 'error'
              ? 'rounded-[24px] border border-red-200 bg-red-50/80 px-5 py-4 text-sm leading-7 text-red-900 shadow-[0_20px_55px_rgba(22,29,42,0.07)]'
              : 'rounded-[24px] border border-emerald-200 bg-emerald-50/80 px-5 py-4 text-sm leading-7 text-emerald-900 shadow-[0_20px_55px_rgba(22,29,42,0.07)]'
          }
        >
          {pageMessage.value}
        </section>
      ) : null}

      <DashboardFiltersDialog
        key={filterPanelKey}
        onApply={handleApplyFilters}
        onClear={() =>
          void navigate({
            params: { projectId },
            search: defaultDashboardSearch,
            to: '/projects/$projectId/dashboard',
          })
        }
        onClose={() => setFiltersOpen(false)}
        open={filtersOpen}
        search={search}
      />

      <DashboardSettingsDialog
        activeDashboard={activeDashboard}
        createDisabled={createDashboardMutation.isPending}
        dashboardNameInput={dashboardNameInput}
        deleteDisabled={deleteDashboardMutation.isPending || activeDashboard === null}
        onCreate={() => createDashboardMutation.mutate()}
        onDelete={() => {
          if (!activeDashboard || !window.confirm(`Delete dashboard "${activeDashboard.name}"?`)) {
            return
          }

          deleteDashboardMutation.mutate()
        }}
        onNameChange={handleDashboardNameInputChange}
        onOpenChange={setDashboardSettingsOpen}
        onRename={() => renameDashboardMutation.mutate()}
        onSetDefault={() => setDefaultDashboardMutation.mutate()}
        open={dashboardSettingsOpen}
        renameDisabled={
          renameDashboardMutation.isPending ||
          activeDashboard === null ||
          dashboardNameInput.trim().length === 0 ||
          dashboardNameInput.trim() === (activeDashboard?.name ?? '')
        }
        setDefaultDisabled={setDefaultDashboardMutation.isPending || activeDashboard === null || activeDashboard.isDefault}
      />

      <WidgetPickerDialog
        onAdd={handleAddWidget}
        onClose={() => setWidgetPickerOpen(false)}
        onRestoreDefaults={handleRestoreDefaultWidgets}
        open={widgetPickerOpen && isEditMode}
        options={widgetOptions}
      />

      {dashboardsQuery.error || metricsQuery.error || recentRunsQuery.error ? (
        <section className="rounded-[28px] border border-red-200 bg-red-50/80 px-6 py-5 text-sm leading-7 text-red-900 shadow-[0_20px_55px_rgba(22,29,42,0.07)]">
          Dashboard data could not be loaded. Please check your project settings or try refreshing.
        </section>
      ) : null}

      {dashboardsQuery.isLoading ? (
        <Panel title="Dashboards">
          <EmptyPanelState message="Loading dashboard configuration..." />
        </Panel>
      ) : dashboards.length === 0 ? (
        <Panel title="Dashboards">
          <div className="space-y-4">
            <EmptyPanelState message="No dashboards exist for this project yet." />
            <Button onClick={() => createDashboardMutation.mutate()} size="sm">
              <Plus className="h-4 w-4" />
              Create dashboard
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <section className="rounded-[28px] border border-[rgb(var(--app-line))] bg-white/90 p-5 shadow-[0_20px_55px_rgba(22,29,42,0.07)]">
            <div className="flex flex-wrap items-center gap-2">
              {dashboards.map((dashboard) => (
                <button
                  className={
                    dashboard.id === activeDashboardId
                      ? 'inline-flex items-center gap-2 rounded-full bg-[rgb(var(--app-accent))] px-4 py-2 text-sm font-medium text-white'
                      : 'inline-flex items-center gap-2 rounded-full border border-[rgb(var(--app-line))] bg-white px-4 py-2 text-sm font-medium text-[rgb(var(--app-ink))] transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))]'
                  }
                  key={dashboard.id}
                  onClick={() => setSelectedDashboardId(dashboard.id)}
                  type="button"
                >
                  {dashboard.name}
                  {dashboard.isDefault ? <Star className="h-3.5 w-3.5" /> : null}
                </button>
              ))}
            </div>
          </section>

          {activeDashboard ? (
            <>
              {activeDashboard.widgets.length === 0 ? (
                <Panel title="Widgets">
                  <div className="space-y-4">
                    <EmptyPanelState message="This dashboard has no widgets yet." />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => { handleStartEditing(); setWidgetPickerOpen(true) }} size="sm">
                        <Plus className="h-4 w-4" />
                        Add widget
                      </Button>
                      <Button onClick={() => { handleStartEditing(); setDraftWidgets(buildDefaultWidgets()) }} size="sm" variant="outline">
                        <RefreshCcw className="h-4 w-4" />
                        Add default widgets
                      </Button>
                    </div>
                  </div>
                </Panel>
              ) : (
                <section className="grid gap-4 xl:auto-rows-[0.65rem] xl:grid-flow-dense xl:grid-cols-[repeat(24,minmax(0,1fr))]">
                  {orderedWidgets.map((widget) => (
                    <WidgetCard
                      active={updateWidgetsMutation.isPending}
                      activeDrag={activeDragWidgetId === widget.id}
                      activeResize={activeResizeWidgetId === widget.id}
                      dragTarget={dragOverWidgetId === widget.id && activeDragWidgetId !== widget.id}
                      editable={isEditMode}
                      key={widget.id}
                      onDragEndWidget={handleDragEndWidget}
                      onDragEnterWidget={handleDragEnterWidget}
                      onDragStartWidget={handleDragStartWidget}
                      onDropWidget={handleDropWidget}
                      onMoveDown={() => handleMoveWidget(widget.id, 1)}
                      onMoveUp={() => handleMoveWidget(widget.id, -1)}
                      onRemove={() => handleRemoveWidget(widget.id)}
                      onResize={handleResizeWidget}
                      onResizeStart={handleResizeStart}
                      recentRuns={recentRuns}
                      resolveDataSourceLabel={resolveDataSourceLabel}
                      widget={widget}
                    >
                      {renderWidgetContent({
                        layout: normalizeWidgetLayout(widget.layout),
                        metrics,
                        recentRuns,
                        widget,
                      })}
                    </WidgetCard>
                  ))}
                </section>
              )}

              <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <Panel title="Cache and Metadata">
                  <div className="space-y-4 text-sm leading-7 text-[rgb(var(--app-muted))]">
                    {metaQuery.data ? (
                      <div className="rounded-[22px] border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/80 px-4 py-4">
                        <p className="font-medium text-[rgb(var(--app-ink))]">Dashboard metadata</p>
                        <p className="mt-2">
                          {metaQuery.data.dataSources.length} data sources, {metaQuery.data.visualizations.length} visualization types available.
                        </p>
                      </div>
                    ) : null}

                    {metrics?.cache ? (
                      <div className="rounded-[22px] border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/80 px-4 py-4">
                        <p className="font-medium text-[rgb(var(--app-ink))]">Cache status</p>
                        <p className="mt-2 text-xs leading-6 text-[rgb(var(--app-muted))]">
                          Generated {formatDateTime(metrics.cache.generatedAt)} - {metrics.cache.hit ? 'cache hit' : 'fresh'} -
                          ttl {metrics.cache.ttlSeconds}s
                        </p>
                      </div>
                    ) : null}
                  </div>
                </Panel>

                <Panel title="Recent launches">
                  {recentRunsQuery.isLoading ? (
                    <EmptyPanelState message="Loading recent launches..." />
                  ) : recentRuns.length > 0 ? (
                    <div className="space-y-3">
                      {recentRuns.map((run) => (
                        <div
                          className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-[rgb(var(--app-line))] bg-white/80 px-4 py-4"
                          key={run.id}
                        >
                          <div>
                            <p className="font-semibold text-[rgb(var(--app-ink))]">{run.name}</p>
                            <p className="mt-1 text-xs text-[rgb(var(--app-muted))]">
                              Run #{run.id} - {formatDateTime(run.startTime)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={statusClassName(run.status)}>{run.status}</span>
                            <Link
                              className="inline-flex items-center gap-2 rounded-full bg-[rgb(var(--app-accent))] px-3 py-2 text-xs font-medium text-white transition hover:bg-[rgb(var(--app-accent-strong))]"
                              params={{ launchId: String(run.id), projectId }}
                              search={{ tab: 'overview' }}
                              to="/projects/$projectId/launches/$launchId"
                            >
                              Open launch
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyPanelState message="No recent launches match the current filters." />
                  )}
                </Panel>
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}

function DashboardFiltersDialog({
  onApply,
  onClear,
  onClose,
  open,
  search,
}: {
  onApply: (nextSearch: ReturnType<typeof projectDashboardRoute.useSearch>) => void
  onClear: () => void
  onClose: () => void
  open: boolean
  search: ReturnType<typeof projectDashboardRoute.useSearch>
}) {
  const [branchInput, setBranchInput] = useState(search.branch ?? '')
  const [dateFromInput, setDateFromInput] = useState(searchValueToDateInput(search.dateFrom))
  const [dateToInput, setDateToInput] = useState(searchValueToDateInput(search.dateTo))
  const [environmentInput, setEnvironmentInput] = useState(search.environment ?? '')
  const [statusInput, setStatusInput] = useState(search.status ?? '')
  const [tagsInput, setTagsInput] = useState(search.tags ?? '')

  const applyFilters = () => {
    onApply({
      branch: branchInput.trim() || undefined,
      dateFrom: normalizeDateInputToSearchValue(dateFromInput, 'start'),
      dateTo: normalizeDateInputToSearchValue(dateToInput, 'end'),
      environment: environmentInput.trim() || undefined,
      refresh: false,
      status: statusInput.trim() || undefined,
      tags: tagsInput.trim() || undefined,
    })
    onClose()
  }

  const clearAll = () => {
    setBranchInput('')
    setDateFromInput('')
    setDateToInput('')
    setEnvironmentInput('')
    setStatusInput('')
    setTagsInput('')
    onClear()
    onClose()
  }

  return (
    <Dialog onOpenChange={(next) => { if (!next) onClose() }} open={open}>
      <DialogContent className="max-w-2xl" data-testid="dashboard-filters-panel">
        <DialogHeader>
          <DialogTitle>Dashboard filters</DialogTitle>
          <DialogDescription>Narrow dashboard metrics by branch, environment, status, tags, or date range.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <FilterInput
            dataTestId="dashboard-filter-branch"
            label="Branch"
            onChange={setBranchInput}
            placeholder="main"
            value={branchInput}
          />
          <FilterInput
            dataTestId="dashboard-filter-environment"
            label="Environment"
            onChange={setEnvironmentInput}
            placeholder="staging"
            value={environmentInput}
          />
          <FilterDateInput
            dataTestId="dashboard-filter-date-from"
            label="Date from"
            onChange={setDateFromInput}
            value={dateFromInput}
          />
          <FilterDateInput
            dataTestId="dashboard-filter-date-to"
            label="Date to"
            onChange={setDateToInput}
            value={dateToInput}
          />

          <label className="space-y-2 text-sm text-[rgb(var(--app-muted))]">
            Status
            <select
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-ring"
              data-testid="dashboard-filter-status"
              onChange={(event) => setStatusInput(event.target.value)}
              value={statusInput}
            >
              <option value="">All</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
            </select>
          </label>

          <FilterInput
            dataTestId="dashboard-filter-tags"
            label="Tags"
            onChange={setTagsInput}
            placeholder="smoke, api"
            value={tagsInput}
          />
        </div>

        <DialogFooter>
          <Button onClick={clearAll} variant="outline">Clear filters</Button>
          <Button onClick={applyFilters}>Apply filters</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DashboardSettingsDialog({
  activeDashboard,
  createDisabled,
  dashboardNameInput,
  deleteDisabled,
  onCreate,
  onDelete,
  onNameChange,
  onOpenChange,
  onRename,
  onSetDefault,
  open,
  renameDisabled,
  setDefaultDisabled,
}: {
  activeDashboard: DashboardConfig | null
  createDisabled: boolean
  dashboardNameInput: string
  deleteDisabled: boolean
  onCreate: () => void
  onDelete: () => void
  onNameChange: (value: string) => void
  onOpenChange: (open: boolean) => void
  onRename: () => void
  onSetDefault: () => void
  open: boolean
  renameDisabled: boolean
  setDefaultDisabled: boolean
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Dashboard settings</DialogTitle>
          <DialogDescription>Manage the current dashboard and create additional views for this project.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-2xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/70 px-4 py-4">
            <p className="text-sm font-semibold text-[rgb(var(--app-ink))]">{activeDashboard?.name ?? 'No active dashboard'}</p>
            <p className="mt-2 text-xs leading-6 text-[rgb(var(--app-muted))]">
              {activeDashboard
                ? `${activeDashboard.widgets.length} widgets configured${activeDashboard.isDefault ? ', currently default.' : '.'}`
                : 'Create a dashboard to start organizing widgets and metrics.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dashboard-name">Dashboard name</Label>
            <Input
              id="dashboard-name"
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Release readiness"
              value={dashboardNameInput}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button disabled={renameDisabled} onClick={onRename} variant="outline">
              <Pencil className="h-4 w-4" />
              Rename dashboard
            </Button>
            <Button disabled={setDefaultDisabled} onClick={onSetDefault} variant="outline">
              <Star className="h-4 w-4" />
              {activeDashboard?.isDefault ? 'Default dashboard' : 'Set as default'}
            </Button>
            <Button disabled={createDisabled} onClick={onCreate} variant="outline">
              <Plus className="h-4 w-4" />
              New dashboard
            </Button>
            <Button className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800" disabled={deleteDisabled} onClick={onDelete} variant="outline">
              <Trash2 className="h-4 w-4" />
              Delete dashboard
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WidgetPickerDialog({
  onAdd,
  onClose,
  onRestoreDefaults,
  open,
  options,
}: {
  onAdd: (option: WidgetOption) => void
  onClose: () => void
  onRestoreDefaults: () => void
  open: boolean
  options: WidgetOption[]
}) {
  return (
    <Dialog onOpenChange={(next) => { if (!next) onClose() }} open={open}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add widget</DialogTitle>
          <DialogDescription>Choose which data source should appear on the dashboard.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          {options.map((option) => (
            <div
              className="rounded-2xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/70 px-4 py-4 transition hover:border-[rgb(var(--app-accent))] hover:bg-white"
              key={option.id}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-[rgb(var(--app-ink))]">{option.label}</p>
                <span className="rounded-full border border-[rgb(var(--app-line))] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--app-muted))]">
                  {option.visualization}
                </span>
              </div>
              <p className="mt-2 text-xs leading-6 text-[rgb(var(--app-muted))]">{option.description}</p>
              <div className="mt-4 rounded-[18px] border border-[rgb(var(--app-line))] bg-white p-3">
                <WidgetOptionPreview option={option} />
              </div>
              <Button className="mt-4 w-full" onClick={() => onAdd(option)} size="sm">
                Add widget
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={onRestoreDefaults} variant="outline">
            <RefreshCcw className="h-4 w-4" />
            Restore default set
          </Button>
          <Button onClick={onClose} variant="outline">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function WidgetCard({
  active,
  activeDrag,
  activeResize,
  children,
  dragTarget,
  editable,
  onDragEndWidget,
  onDragEnterWidget,
  onDragStartWidget,
  onDropWidget,
  onMoveDown,
  onMoveUp,
  onRemove,
  onResize,
  onResizeStart,
  recentRuns,
  resolveDataSourceLabel,
  widget,
}: {
  active: boolean
  activeDrag: boolean
  activeResize: boolean
  children: React.ReactNode
  dragTarget: boolean
  editable: boolean
  onDragEndWidget: () => void
  onDragEnterWidget: (sourceWidgetId: string, targetWidgetId: string) => void
  onDragStartWidget: (widgetId: string) => void
  onDropWidget: (sourceWidgetId: string, targetWidgetId: string) => void
  onMoveDown: () => void
  onMoveUp: () => void
  onRemove: () => void
  onResize: (widgetId: string, nextLayout: Partial<Pick<DashboardWidgetLayout, 'h' | 'w'>>) => void
  onResizeStart: (
    event: React.PointerEvent<HTMLButtonElement>,
    widgetId: string,
    mode: 'both' | 'height' | 'width',
  ) => void
  recentRuns: TestRun[]
  resolveDataSourceLabel: (dataSource: string) => string
  widget: DashboardWidget
}) {
  const layout = normalizeWidgetLayout(widget.layout)
  const sizeKey = layoutToSizeKey(layout)
  const belowRecommendedSize = isBelowRecommendedWidgetSize(widget, layout)
  const widgetStyle = {
    '--widget-height': `${5 + layout.h * 2.75}rem`,
    '--widget-rows': String(layoutToGridRows(layout.h)),
    '--widget-span': String(layout.w),
  } as React.CSSProperties

  return (
    <section
      className={`relative min-h-[var(--widget-height)] min-w-0 rounded-[28px] border border-[rgb(var(--app-line))] bg-white/90 p-5 shadow-[0_20px_55px_rgba(22,29,42,0.07)] transition-[transform,box-shadow,opacity,grid-column,grid-row,border-color,background-color] duration-150 xl:[grid-column:span_var(--widget-span)_/_span_var(--widget-span)] xl:[grid-row:span_var(--widget-rows)_/_span_var(--widget-rows)] ${editable ? 'ring-1 ring-[rgb(var(--app-accent))]/15' : ''} ${belowRecommendedSize ? 'border-red-400/45 bg-red-50/20' : ''} ${activeResize ? 'ring-2 ring-[rgb(var(--app-accent))]/45 shadow-[0_28px_80px_rgba(59,130,246,0.18)]' : ''} ${activeDrag ? 'scale-[0.985] opacity-60 shadow-[0_14px_40px_rgba(59,130,246,0.16)]' : ''} ${dragTarget ? 'ring-2 ring-emerald-400/60 shadow-[0_24px_70px_rgba(16,185,129,0.18)]' : ''}`}
      draggable={editable && !activeResize}
      onDragEnd={() => onDragEndWidget()}
      onDragEnter={(event) => {
        if (!editable) {
          return
        }

        event.preventDefault()
        const sourceWidgetId = event.dataTransfer.getData('text/widget-id')
        if (sourceWidgetId) {
          onDragEnterWidget(sourceWidgetId, widget.id)
        }
      }}
      onDragOver={(event) => {
        if (editable) {
          event.preventDefault()
        }
      }}
      onDrop={(event) => {
        if (!editable) {
          return
        }

        event.preventDefault()
        const sourceWidgetId = event.dataTransfer.getData('text/widget-id')
        if (sourceWidgetId) {
          onDropWidget(sourceWidgetId, widget.id)
        }
      }}
      onDragStart={(event) => {
        if (!editable || activeResize) {
          return
        }

        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/widget-id', widget.id)
        onDragStartWidget(widget.id)
      }}
      style={widgetStyle}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[rgb(var(--app-ink))]">{widget.title}</p>
          <p className="mt-1 text-xs leading-6 text-[rgb(var(--app-muted))]">
            {resolveDataSourceLabel(widget.dataSource)} • {widget.visualization}
          </p>
          {editable ? (
            <p className="text-xs leading-6 text-[rgb(var(--app-muted))]">
              Drag card to move it. Pull the right or bottom handle to resize. Changes stay local until you save.
            </p>
          ) : null}
          {widget.dataSource === 'recent-runs' ? (
            <p className="text-xs leading-6 text-[rgb(var(--app-muted))]">{recentRuns.length} launches in current scope.</p>
          ) : null}
        </div>

        {editable ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              aria-label="Move widget earlier"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(var(--app-line))] bg-white text-[rgb(var(--app-muted))] shadow-sm transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))]"
              disabled={active}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onMoveUp()
              }}
              type="button"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              aria-label="Move widget later"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(var(--app-line))] bg-white text-[rgb(var(--app-muted))] shadow-sm transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))]"
              disabled={active}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onMoveDown()
              }}
              type="button"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <span className="rounded-full border border-[rgb(var(--app-line))] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--app-muted))]">
            {sizeKey} • {layout.w}w × {layout.h}h
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-4">{children}</div>

      {editable ? (
        <>
          <button
            aria-label="Delete widget"
            className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-white/90 text-red-600 shadow-sm transition hover:border-red-300 hover:bg-red-50"
            disabled={active}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onRemove()
            }}
            type="button"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          {activeResize ? (
            <>
              <div className="pointer-events-none absolute inset-0 rounded-[28px] border-2 border-dashed border-[rgb(var(--app-accent))]/60 bg-[linear-gradient(135deg,rgba(59,130,246,0.08),rgba(59,130,246,0.03))]" />
              <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-[rgb(var(--app-accent))] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white shadow-lg">
                {layout.w}/24 x {layout.h}
              </div>
              <div className="pointer-events-none absolute inset-y-8 right-1 w-2 rounded-full bg-[rgb(var(--app-accent))]/20" />
              <div className="pointer-events-none absolute inset-x-8 bottom-1 h-2 rounded-full bg-[rgb(var(--app-accent))]/20" />
              <div className="pointer-events-none absolute inset-4 rounded-[22px] border border-white/70" />
            </>
          ) : null}
          {belowRecommendedSize && !activeResize ? (
            <>
              <div className="pointer-events-none absolute inset-0 rounded-[28px] border border-red-500/35" />
              <div className="pointer-events-none absolute right-4 top-4 rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-red-700">
                Tight fit
              </div>
            </>
          ) : null}
          {dragTarget ? (
            <div className="pointer-events-none absolute inset-2 rounded-[24px] border-2 border-dashed border-emerald-400/70 bg-emerald-400/5" />
          ) : null}
          <button
            aria-label="Resize width"
            className={`absolute inset-y-10 right-0 w-3 cursor-ew-resize rounded-r-[28px] transition ${activeResize ? 'bg-[rgb(var(--app-accent))]/12' : 'hover:bg-[rgb(var(--app-accent))]/10'}`}
            onPointerDown={(event) => onResizeStart(event, widget.id, 'width')}
            type="button"
          >
            <span className={`mx-auto block h-12 w-1 rounded-full ${activeResize ? 'bg-[rgb(var(--app-accent))]' : 'bg-[rgb(var(--app-line))]'}`} />
          </button>
          <button
            aria-label="Resize height"
            className={`absolute inset-x-10 bottom-0 h-3 cursor-ns-resize rounded-b-[28px] transition ${activeResize ? 'bg-[rgb(var(--app-accent))]/12' : 'hover:bg-[rgb(var(--app-accent))]/10'}`}
            onPointerDown={(event) => onResizeStart(event, widget.id, 'height')}
            type="button"
          >
            <span className={`mx-auto mt-1 block h-1 w-12 rounded-full ${activeResize ? 'bg-[rgb(var(--app-accent))]' : 'bg-[rgb(var(--app-line))]'}`} />
          </button>
          <button
            aria-label="Resize widget"
            className={`absolute bottom-2 right-2 flex h-6 w-6 cursor-nwse-resize items-center justify-center rounded-full border bg-white shadow-sm transition ${
              activeResize
                ? 'border-[rgb(var(--app-accent))] text-[rgb(var(--app-accent))]'
                : 'border-[rgb(var(--app-line))] text-[rgb(var(--app-muted))] hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))]'
            }`}
            onDoubleClick={() => onResize(widget.id, { h: 2, w: 12 })}
            onPointerDown={(event) => onResizeStart(event, widget.id, 'both')}
            type="button"
          >
            <ArrowRight className="h-3 w-3 rotate-45" />
          </button>
        </>
      ) : null}
    </section>
  )
}

function WidgetOptionPreview({ option }: { option: WidgetOption }) {
  if (option.id === 'test-summary') {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <PreviewChip label="Passed" value="128" />
        <PreviewChip label="Unstable" value="7" />
        <PreviewChip label="Skipped" value="4" />
        <PreviewChip label="Rate" value="94%" />
      </div>
    )
  }

  if (option.id === 'pass-rate' || option.id === 'flaky-rate') {
    return (
      <div className="flex min-h-[7rem] items-center justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full border-8 border-emerald-200 text-lg font-semibold text-[rgb(var(--app-ink))]">
          {option.id === 'pass-rate' ? '94%' : '6%'}
        </div>
      </div>
    )
  }

  if (option.id === 'recent-runs' || option.id === 'top-failing-tests' || option.id === 'top-failing-suites') {
    return (
      <div className="space-y-2">
        <PreviewRow left="Item A" right="12" />
        <PreviewRow left="Item B" right="7" />
        <PreviewRow left="Item C" right="3" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="h-3 w-24 rounded-full bg-[rgb(var(--app-line))]" />
      <div className="h-24 rounded-2xl bg-[linear-gradient(180deg,rgba(16,185,129,0.16),rgba(59,130,246,0.08))]" />
      <div className="flex gap-2">
        <div className="h-2 w-12 rounded-full bg-emerald-300" />
        <div className="h-2 w-10 rounded-full bg-red-300" />
        <div className="h-2 w-8 rounded-full bg-amber-300" />
      </div>
    </div>
  )
}

function PreviewChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/70 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--app-muted))]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[rgb(var(--app-ink))]">{value}</p>
    </div>
  )
}

function PreviewRow({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[rgb(var(--app-line))] px-3 py-2">
      <span className="text-xs text-[rgb(var(--app-muted))]">{left}</span>
      <span className="text-xs font-semibold text-[rgb(var(--app-ink))]">{right}</span>
    </div>
  )
}

function FilterInput({
  dataTestId,
  label,
  onChange,
  placeholder,
  value,
}: {
  dataTestId: string
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <label className="space-y-2 text-sm text-[rgb(var(--app-muted))]">
      {label}
      <input
        className="w-full rounded-2xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/80 px-4 py-3 text-sm text-[rgb(var(--app-ink))] outline-none transition focus:border-[rgb(var(--app-accent))]"
        data-testid={dataTestId}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </label>
  )
}

function FilterDateInput({
  dataTestId,
  label,
  onChange,
  value,
}: {
  dataTestId: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <label className="space-y-2 text-sm text-[rgb(var(--app-muted))]">
      {label}
      <input
        className="w-full rounded-2xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/80 px-4 py-3 text-sm text-[rgb(var(--app-ink))] outline-none transition focus:border-[rgb(var(--app-accent))]"
        data-testid={dataTestId}
        onChange={(event) => onChange(event.target.value)}
        type="date"
        value={value}
      />
    </label>
  )
}

function SummaryCard({
  description,
  label,
  value,
}: {
  description?: null | string
  label: string
  value: string
}) {
  return (
    <div className="rounded-[24px] border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/75 p-4 shadow-[0_14px_36px_rgba(22,29,42,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--app-muted))]">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-[rgb(var(--app-ink))]">{value}</p>
      <p className="mt-2 text-xs leading-6 text-[rgb(var(--app-muted))]">{description}</p>
    </div>
  )
}

function Panel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-[28px] border border-[rgb(var(--app-line))] bg-white/90 p-5 shadow-[0_20px_55px_rgba(22,29,42,0.07)]">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[rgb(var(--app-muted))]">{title}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function EmptyPanelState({ message }: { message: string }) {
  return (
    <div className="rounded-[22px] border border-dashed border-[rgb(var(--app-line))] px-4 py-8 text-sm text-[rgb(var(--app-muted))]">
      {message}
    </div>
  )
}

function renderWidgetContent({
  layout,
  metrics,
  recentRuns,
  widget,
}: {
  layout: DashboardWidgetLayout
  metrics?: DashboardMetricsResponse
  recentRuns: TestRun[]
  widget: DashboardWidget
}) {
  const viewport = resolveWidgetViewport(layout)
  const listLimit = viewport === 'compact' ? 2 : viewport === 'medium' ? 4 : 6

  if (!metrics && widget.dataSource !== 'recent-runs' && widget.dataSource !== 'latest-run-status') {
    return <EmptyPanelState message="Loading widget data..." />
  }

  switch (widget.dataSource) {
      case 'test-summary':
        return (
          <div className={`grid gap-2 ${viewport === 'compact' ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
            <StatMiniCard
              colorClassName="bg-sky-50 text-sky-700"
              compact={viewport === 'compact'}
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Passed"
              value={String(metrics?.summary.passed ?? 0)}
            />
            <StatMiniCard
              colorClassName="bg-rose-50 text-rose-700"
              compact={viewport === 'compact'}
              icon={<XCircle className="h-4 w-4" />}
              label="Unstable"
              value={String((metrics?.summary.failed ?? 0) + (metrics?.summary.broken ?? 0))}
            />
            <StatMiniCard
              colorClassName="bg-amber-50 text-amber-700"
              compact={viewport === 'compact'}
              icon={<Clock className="h-4 w-4" />}
              label="Skipped"
              value={String(metrics?.summary.skipped ?? 0)}
            />
            <StatMiniCard
              colorClassName="bg-emerald-50 text-emerald-700"
              compact={viewport === 'compact'}
              icon={<Star className="h-4 w-4" />}
              label="Pass rate"
              value={`${metrics?.summary.passRate ?? 0}%`}
          />
        </div>
      )
      case 'test-trend':
      case 'pass-fail-trend':
        return metrics && metrics.passFailTrend.length > 0 ? (
          <div className="space-y-2 overflow-hidden" data-testid="widget-pass-fail-trend">
            {metrics.passFailTrend.slice(0, listLimit).map((point) => (
              <TrendRow compact={viewport === 'compact'} key={point.date} point={point} />
            ))}
          </div>
        ) : (
          <EmptyPanelState message="No trend data is available for the current filter set." />
        )
      case 'pass-rate':
        return <PassRateWidget compact={viewport === 'compact'} value={metrics?.summary.passRate ?? 0} />
      case 'flaky-rate':
        return metrics ? (
          <div className={`rounded-[22px] border border-fuchsia-100 bg-fuchsia-50/80 ${viewport === 'compact' ? 'px-3 py-3' : 'px-4 py-4'}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-700">Flaky rate</p>
            <p className={`font-semibold text-fuchsia-950 ${viewport === 'compact' ? 'mt-2 text-2xl' : 'mt-3 text-3xl'}`}>{metrics.flakyRate.percentage}%</p>
            <p className={`text-fuchsia-800 ${viewport === 'compact' ? 'mt-1 text-[11px] leading-5' : 'mt-2 text-xs leading-6'}`}>
              {viewport === 'compact'
                ? `${metrics.flakyRate.flakyTests}/${metrics.flakyRate.trackedTests} tracked`
                : `${metrics.flakyRate.flakyTests} flaky tests out of ${metrics.flakyRate.trackedTests} tracked.`}
            </p>
          </div>
        ) : (
          <EmptyPanelState message="Flaky rate is not available yet." />
        )
      case 'top-failing-tests':
        return metrics && metrics.topFailingTests.length > 0 ? (
          <div className="space-y-2 overflow-hidden" data-testid="widget-top-failing-tests">
            {metrics.topFailingTests.slice(0, listLimit).map((row) => (
              <MetricListRow
                compact={viewport === 'compact'}
                key={row.name}
                subtitle={
                  viewport === 'compact'
                    ? row.lastStatus
                    : `last: ${row.lastStatus}${row.flakyRuns > 0 ? ` - flaky (${row.flakyRuns})` : ''}`
                }
                title={row.name}
                value={`${row.failures} fails`}
              />
          ))}
        </div>
      ) : (
        <EmptyPanelState message="No failing tests in selected scope." />
      )
      case 'top-failing-suites':
        return metrics && metrics.topFailingSuites.length > 0 ? (
          <div className="space-y-2 overflow-hidden" data-testid="widget-top-failing-suites">
            {metrics.topFailingSuites.slice(0, listLimit).map((row) => (
              <MetricListRow
                compact={viewport === 'compact'}
                key={row.name}
                subtitle={viewport === 'compact' ? `${row.tests} tests` : `${row.tests} tests in suite`}
                title={row.name}
                value={`${row.failures} fails`}
              />
          ))}
        </div>
      ) : (
        <EmptyPanelState message="No failing suites in selected scope." />
      )
      case 'recent-runs':
        return recentRuns.length > 0 ? (
          <div className="space-y-2 overflow-hidden">
            {recentRuns.slice(0, listLimit).map((run) => (
              <div
                className={`flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/70 ${viewport === 'compact' ? 'px-3 py-2' : 'px-4 py-3'}`}
                key={run.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-[rgb(var(--app-ink))]">{run.name}</p>
                  {viewport === 'compact' ? null : (
                    <p className="mt-1 text-xs text-[rgb(var(--app-muted))]">{formatDateTime(run.startTime)}</p>
                  )}
                </div>
                <span className={statusClassName(run.status, viewport === 'compact')}>{run.status}</span>
              </div>
            ))}
          </div>
      ) : (
        <EmptyPanelState message="No recent launches match the current filters." />
      )
      case 'latest-run-status': {
        const latestRun = recentRuns[0]
        return latestRun ? <LatestRunStatusWidget compact={viewport === 'compact'} run={latestRun} /> : <EmptyPanelState message="No runs recorded yet." />
      }
    default:
      return <EmptyPanelState message="Unsupported widget data source." />
  }
}

function StatMiniCard({
  colorClassName,
  compact = false,
  icon,
  label,
  value,
}: {
  colorClassName: string
  compact?: boolean
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className={`min-w-0 rounded-[20px] border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/70 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate font-semibold uppercase tracking-[0.2em] text-[rgb(var(--app-muted))] ${compact ? 'text-[10px]' : 'text-xs'}`}>{label}</p>
          <p className={`truncate font-semibold text-[rgb(var(--app-ink))] ${compact ? 'mt-1 text-lg' : 'mt-2 text-2xl'}`}>{value}</p>
        </div>
        <div className={`shrink-0 rounded-full ${compact ? 'p-2' : 'p-3'} ${colorClassName}`}>{icon}</div>
      </div>
    </div>
  )
}

function PassRateWidget({ compact = false, value }: { compact?: boolean; value: number }) {
  const circumference = 283
  const dash = `${Math.max(0, Math.min(value, 100)) * 2.83} ${circumference}`

  return (
    <div className={`flex items-center justify-center ${compact ? 'min-h-[8rem]' : 'min-h-[16rem]'}`}>
      <div className={`relative ${compact ? 'h-24 w-24' : 'h-44 w-44'}`}>
        <svg className="h-full w-full" viewBox="0 0 100 100">
          <circle cx="50" cy="50" fill="transparent" r="45" stroke="currentColor" strokeWidth="10" className="text-[rgb(var(--app-line))]" />
          <circle
            cx="50"
            cy="50"
            fill="transparent"
            r="45"
            stroke="currentColor"
            strokeDasharray={dash}
            strokeLinecap="round"
            strokeWidth="10"
            transform="rotate(-90 50 50)"
            className="text-emerald-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-semibold text-[rgb(var(--app-ink))] ${compact ? 'text-lg' : 'text-3xl'}`}>{Math.round(value)}%</span>
          {compact ? null : <span className="text-xs text-[rgb(var(--app-muted))]">Pass rate</span>}
        </div>
      </div>
    </div>
  )
}

function LatestRunStatusWidget({ compact = false, run }: { compact?: boolean; run: TestRun }) {
  return (
    <div className={`flex flex-col justify-between rounded-[22px] border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/70 ${compact ? 'min-h-[8rem] p-3' : 'min-h-[16rem] p-4'}`}>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--app-muted))]">Latest run</p>
        <p className={`truncate font-semibold text-[rgb(var(--app-ink))] ${compact ? 'mt-1 text-base' : 'mt-2 text-lg'}`}>{run.name}</p>
        {compact ? null : <p className="mt-1 text-xs text-[rgb(var(--app-muted))]">{formatDateTime(run.startTime)}</p>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className={statusClassName(run.status, compact)}>{run.status}</span>
        <div className="text-right">
          <p className={`font-semibold text-[rgb(var(--app-ink))] ${compact ? 'text-lg' : 'text-2xl'}`}>{run.stats.passRate}%</p>
          {compact ? null : <p className="text-xs text-[rgb(var(--app-muted))]">Pass rate</p>}
        </div>
      </div>
    </div>
  )
}

function TrendRow({
  compact = false,
  point,
}: {
  compact?: boolean
  point: { broken: number; date: string; failed: number; passed: number; skipped: number; total: number }
}) {
  const total = Math.max(point.total, 1)
  const passedWidth = `${(point.passed / total) * 100}%`
  const failedWidth = `${((point.failed + point.broken) / total) * 100}%`
  const skippedWidth = `${(point.skipped / total) * 100}%`

  return (
    <div className={`rounded-[22px] border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/80 ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--app-muted))]">
        <span>{point.date}</span>
        {compact ? null : <span>{point.total} tests</span>}
      </div>
      <div className={`flex overflow-hidden rounded-full bg-[rgb(var(--app-line))] ${compact ? 'mt-2 h-2' : 'mt-3 h-3'}`}>
        <div className="bg-emerald-500" style={{ width: passedWidth }} />
        <div className="bg-red-500" style={{ width: failedWidth }} />
        <div className="bg-amber-400" style={{ width: skippedWidth }} />
      </div>
      {compact ? null : (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-[rgb(var(--app-muted))]">
          <span>{point.passed} passed</span>
          <span>{point.failed + point.broken} unstable</span>
          <span>{point.skipped} skipped</span>
        </div>
      )}
    </div>
  )
}

function MetricListRow({ compact = false, subtitle, title, value }: { compact?: boolean; subtitle: string; title: string; value: string }) {
  return (
    <div className={`min-w-0 rounded-[22px] border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/80 text-sm ${compact ? 'px-3 py-3' : 'px-4 py-4'}`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`min-w-0 ${compact ? 'truncate text-sm' : 'line-clamp-2'} font-medium text-[rgb(var(--app-ink))]`}>{title}</p>
        <span className={`shrink-0 rounded-full bg-red-50 font-semibold uppercase tracking-[0.18em] text-red-700 ${compact ? 'px-2 py-1 text-[10px]' : 'px-2 py-1 text-[11px]'}`}>
          {value}
        </span>
      </div>
      {subtitle ? <p className={`text-[rgb(var(--app-muted))] ${compact ? 'mt-1 text-[11px] leading-5' : 'mt-2 text-xs leading-6'}`}>{subtitle}</p> : null}
    </div>
  )
}

function formatDateTime(value?: null | string) {
  if (!value) {
    return 'Timestamp unavailable'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function layoutToSizeKey(layout: DashboardWidgetLayout) {
  if (layout.w >= 24) {
    return 'xl'
  }

  if (layout.w >= 16) {
    return 'l'
  }

  if (layout.w >= 12) {
    return 'm'
  }

  return 's'
}

function normalizeWidgetLayout(layout?: DashboardWidgetLayout, index = 0, dataSource?: string): DashboardWidgetLayout {
  const minimumSize = getWidgetMinimumSize(dataSource)

  if (!layout) {
    return ensureWidgetLayoutForSource(dataSource, buildLayout(index))
  }

  return {
    h: clamp(layout.h > 0 ? layout.h : minimumSize.h, minimumSize.h, 8),
    w: clamp(layout.w > 0 ? layout.w : minimumSize.w, minimumSize.w, 24),
    x: 0,
    y: index,
  }
}

function layoutToGridRows(heightUnits: number) {
  return 8 + heightUnits * 5
}

function resolveDataSourceLabel(dataSource: string) {
  return dataSourceDefaults[dataSource as DashboardSourceId]?.label ?? dataSource
}

function statusClassName(status: string, compact = false) {
  const toneClassName =
    status === 'completed'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'failed'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-blue-200 bg-blue-50 text-blue-700'

  return `inline-flex rounded-full border font-semibold uppercase tracking-[0.18em] ${compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1 text-xs'} ${toneClassName}`
}

function resolveErrorMessage(error: unknown, fallback: string) {
  if (isApiError(error)) {
    return error.message
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function resolveWidgetViewport(layout: DashboardWidgetLayout): WidgetViewport {
  if (layout.w <= 8 || layout.h <= 1) {
    return 'compact'
  }

  if (layout.w <= 12 || layout.h <= 2) {
    return 'medium'
  }

  return 'wide'
}

function isBelowRecommendedWidgetSize(widget: DashboardWidget, layout: DashboardWidgetLayout) {
  const recommended = getWidgetMinimumSize(widget.dataSource)

  return layout.w < recommended.w || layout.h < recommended.h
}

function getWidgetMinimumSize(dataSource?: string) {
  return widgetMinimumSizeBySource[dataSource ?? ''] ?? { h: 2, w: 12 }
}

function ensureWidgetLayoutForSource(dataSource: string | undefined, layout: DashboardWidgetLayout) {
  const minimumSize = getWidgetMinimumSize(dataSource)

  return {
    ...layout,
    h: clamp(layout.h, minimumSize.h, 8),
    w: clamp(layout.w, minimumSize.w, 24),
  }
}
