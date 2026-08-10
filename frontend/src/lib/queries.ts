import {
  allureImportJobResultSchema,
  createRunRequestSchema,
  createAllureImportJobFormSchema,
  createAllureImportJobRequestSchema,
  projectSchema,
  runSchema,
  runsListResponseSchema,
  testResultsResponseSchema,
  type AllureImportJobResult,
  type CreateRunRequest,
  type DashboardMetricsSearch,
  type LaunchesListSearch,
  type Run as ContractRun,
} from '@veriqorn/contracts'
import { QueryClient, queryOptions } from '@tanstack/react-query'

import type { ApiClient } from '@/lib/api'
import { isRecord, unwrapApiData } from '@/lib/api'
import { encodeProjectId, normalizeProjectId, resolvePreferredProjectId } from '@/lib/project-paths'
import type {
  AiAnalysisCapabilitiesResponse,
  DashboardConfig,
  DashboardMeta,
  DashboardMetaOption,
  DashboardMetricsCache,
  DashboardMetricsFilters,
  DashboardMetricsResponse,
  DashboardMetricsSummary,
  DashboardPassFailTrendPoint,
  DashboardState,
  DashboardTopFailingSuite,
  DashboardTopFailingTest,
  DashboardWidget,
  DashboardWidgetLayout,
  ProjectSummary,
  TestAttachment,
  TestResult,
  TestResultDiagnostics,
  TestResultHistoryItem,
  TestResultLabel,
  TestResultsMeta,
  TestResultsResponse,
  TestRun,
  TestRunStats,
  TestStep,
} from '@/types'

const toNumber = (value: unknown, fallback = 0) => {
  const normalizedValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(normalizedValue) ? normalizedValue : fallback
}

const toOptionalString = (value: unknown) => {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()
  return normalizedValue ? normalizedValue : null
}

const toStringValue = (value: unknown, fallback = '') => {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return fallback
}

const toStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.map((entry) => toStringValue(entry).trim()).filter((entry) => entry.length > 0)
    : []

const normalizeProjectSummary = (value: unknown): ProjectSummary => {
  const record = isRecord(value) ? value : {}

  return projectSchema.parse({
    createdAt: String(record.createdAt ?? ''),
    description: typeof record.description === 'string' ? record.description : null,
    id: normalizeProjectId(record.id as string | number | null | undefined),
    isArchived: Boolean(record.isArchived),
    isDefault: Boolean(record.isDefault),
    key: String(record.key ?? 'project'),
    name: String(record.name ?? 'Unnamed project'),
    updatedAt: String(record.updatedAt ?? ''),
  })
}

const normalizeRunStats = (value: unknown): TestRunStats => {
  const record = isRecord(value) ? value : {}

  return {
    broken: toNumber(record.broken),
    failed: toNumber(record.failed),
    passRate: toNumber(record.passRate),
    passed: toNumber(record.passed),
    skipped: toNumber(record.skipped),
    total: toNumber(record.total),
  }
}

const emptyRunStats = (): TestRunStats => ({
  broken: 0,
  failed: 0,
  passRate: 0,
  passed: 0,
  skipped: 0,
  total: 0,
})

const normalizeContractRun = (run: ContractRun): TestRun => ({
  branch: run.branch ?? null,
  endTime: run.endTime ?? null,
  environment: run.environment ?? null,
  id: String(run.id),
  name: run.name,
  projectId: run.projectId ?? null,
  startTime: run.startTime ?? null,
  stats: run.stats ?? emptyRunStats(),
  status: run.status,
  tags: run.tags ?? [],
  uuid: run.uuid ?? undefined,
})

const normalizeRun = (value: unknown): TestRun => {
  const record = isRecord(value) ? value : {}

  return normalizeContractRun(
    runSchema.parse({
      branch: toOptionalString(record.branch),
      endTime: toOptionalString(record.endTime),
      environment: toOptionalString(record.environment),
      id: toNumber(record.id, Number.NaN),
      name: toStringValue(record.name, 'Unnamed launch'),
      projectId: toOptionalString(record.projectId),
      startTime: toOptionalString(record.startTime),
      stats: isRecord(record.stats) ? normalizeRunStats(record.stats) : undefined,
      status: toStringValue(record.status, 'unknown'),
      tags: toStringArray(record.tags),
      uuid: toOptionalString(record.uuid),
    }),
  )
}

const normalizeAllureImportJobResult = (value: unknown): Omit<AllureImportJobResult, 'testRun'> & { testRun: TestRun } => {
  const parsed = allureImportJobResultSchema.parse(value)

  return {
    ...parsed,
    testRun: normalizeContractRun(parsed.testRun),
  }
}

const normalizeAttachment = (value: unknown): TestAttachment => {
  const record = isRecord(value) ? value : {}

  return {
    id: toStringValue(record.id),
    isTrace: Boolean(record.isTrace),
    name: toStringValue(record.name, 'Attachment'),
    source: toStringValue(record.source),
    traceAssetUrl: toOptionalString(record.traceAssetUrl) ?? undefined,
    traceTokenExpiresAt: toOptionalString(record.traceTokenExpiresAt) ?? undefined,
    traceViewerUrl: toOptionalString(record.traceViewerUrl) ?? undefined,
    type: toStringValue(record.type, 'application/octet-stream'),
  }
}

const normalizeStep = (value: unknown): TestStep => {
  const record = isRecord(value) ? value : {}
  const statusDetails = isRecord(record.statusDetails) ? record.statusDetails : {}
  const normalizedTrace =
    toOptionalString(statusDetails.trace) ??
    toOptionalString(statusDetails.stackTrace) ??
    toOptionalString(statusDetails.stacktrace)

  return {
    attachments: Array.isArray(record.attachments) ? record.attachments.map(normalizeAttachment) : [],
    childSteps: Array.isArray(record.childSteps) ? record.childSteps.map(normalizeStep) : [],
    endTime: toOptionalString(record.endTime) ?? undefined,
    id: toStringValue(record.id),
    name: toStringValue(record.name, 'Unnamed step'),
    parameters: record.parameters,
    stage: toOptionalString(record.stage) ?? undefined,
    startTime: toOptionalString(record.startTime) ?? undefined,
    status: toOptionalString(record.status) ?? undefined,
    statusDetails:
      Object.keys(statusDetails).length > 0
        ? {
            message: toOptionalString(statusDetails.message) ?? undefined,
            trace: normalizedTrace ?? undefined,
          }
        : undefined,
  }
}

const normalizeResultLabel = (value: unknown): TestResultLabel => {
  const record = isRecord(value) ? value : {}

  return {
    name: toStringValue(record.name, 'label'),
    value: toStringValue(record.value),
  }
}

const normalizeDiagnostics = (value: unknown): TestResultDiagnostics | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  return {
    failedStepName: toOptionalString(value.failedStepName) ?? undefined,
    hasAttachments: typeof value.hasAttachments === 'boolean' ? value.hasAttachments : undefined,
    message: toOptionalString(value.message) ?? undefined,
    stackTrace: toOptionalString(value.stackTrace) ?? undefined,
    status: toOptionalString(value.status) ?? undefined,
  }
}

const normalizeHistoryItem = (value: unknown): TestResultHistoryItem => {
  const record = isRecord(value) ? value : {}

  return {
    duration: Number.isFinite(toNumber(record.duration, Number.NaN)) ? toNumber(record.duration) : undefined,
    endTime: toOptionalString(record.endTime) ?? undefined,
    id: toStringValue(record.id),
    startTime: toStringValue(record.startTime),
    status: toStringValue(record.status, 'unknown'),
    testRunId: toOptionalString(record.testRunId) ?? undefined,
    uuid: toOptionalString(record.uuid) ?? undefined,
  }
}

const normalizeResult = (value: unknown): TestResult => {
  const record = isRecord(value) ? value : {}

  return {
    allureId: toOptionalString(record.allureId) ?? undefined,
    diagnostics: normalizeDiagnostics(record.diagnostics),
    duration: toNumber(record.duration),
    endTime: toOptionalString(record.endTime) ?? undefined,
    history: Array.isArray(record.history) ? record.history.map(normalizeHistoryItem) : [],
    historyId: toOptionalString(record.historyId) ?? undefined,
    id: toStringValue(record.id),
    labels: Array.isArray(record.labels) ? record.labels.map(normalizeResultLabel) : [],
    name: toStringValue(record.name, 'Unnamed test'),
    parameters: record.parameters,
    retries: Array.isArray(record.retries) ? record.retries.map(normalizeHistoryItem) : [],
    startTime: toOptionalString(record.startTime) ?? undefined,
    status: toStringValue(record.status, 'unknown'),
    steps: Array.isArray(record.steps) ? record.steps.map(normalizeStep) : [],
    totalAttachments: toNumber(record.totalAttachments),
    uuid: toOptionalString(record.uuid) ?? undefined,
  }
}

const normalizeResultsMeta = (value: unknown, fallbackRunId = ''): TestResultsMeta => {
  const record = isRecord(value) ? value : {}

  return {
    brokenCount: toNumber(record.brokenCount),
    failedCount: toNumber(record.failedCount),
    generatedAt: toStringValue(record.generatedAt),
    passedCount: toNumber(record.passedCount),
    runId: toStringValue(record.runId, fallbackRunId),
    skippedCount: toNumber(record.skippedCount),
    totalAttachments: toNumber(record.totalAttachments),
    totalResults: toNumber(record.totalResults),
  }
}

export const normalizeResultsResponse = (value: unknown): TestResultsResponse => {
  const record = isRecord(value) ? value : {}
  const items = Array.isArray(record.items) ? record.items.map(normalizeResult) : []
  const meta = normalizeResultsMeta(record.meta, toStringValue(record.runId))

  return testResultsResponseSchema.parse({
    items,
    meta: {
      ...meta,
      totalResults: meta.totalResults || items.length,
    },
    total: toNumber(record.total, items.length),
  })
}

const normalizeWidgetLayout = (value: unknown): DashboardWidgetLayout | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  return {
    h: toNumber(value.h),
    w: toNumber(value.w),
    x: toNumber(value.x),
    y: toNumber(value.y),
  }
}

const normalizeWidget = (value: unknown): DashboardWidget => {
  const record = isRecord(value) ? value : {}

  return {
    dataSource: toStringValue(record.dataSource, 'unknown'),
    id: toStringValue(record.id),
    layout: normalizeWidgetLayout(record.layout),
    title: toStringValue(record.title, 'Widget'),
    visualization: toStringValue(record.visualization, 'stat'),
  }
}

const normalizeDashboard = (value: unknown): DashboardConfig => {
  const record = isRecord(value) ? value : {}

  return {
    id: toStringValue(record.id),
    isDefault: Boolean(record.isDefault),
    name: toStringValue(record.name, 'Dashboard'),
    order: toNumber(record.order),
    updatedAt: toStringValue(record.updatedAt),
    widgets: Array.isArray(record.widgets) ? record.widgets.map(normalizeWidget) : [],
  }
}

const normalizeDashboardState = (value: unknown): DashboardState => {
  const record = isRecord(value) ? value : {}

  return {
    dashboards: Array.isArray(record.dashboards) ? record.dashboards.map(normalizeDashboard) : [],
  }
}

const normalizeDashboardMetaOption = (value: unknown): DashboardMetaOption => {
  const record = isRecord(value) ? value : {}

  return {
    id: toStringValue(record.id),
    label: toStringValue(record.label, 'Option'),
  }
}

const normalizeDashboardMeta = (value: unknown): DashboardMeta => {
  const record = isRecord(value) ? value : {}

  return {
    dataSources: Array.isArray(record.dataSources) ? record.dataSources.map(normalizeDashboardMetaOption) : [],
    visualizations: Array.isArray(record.visualizations)
      ? record.visualizations.map(normalizeDashboardMetaOption)
      : [],
  }
}

const normalizeDashboardMetricsFilters = (value: unknown): DashboardMetricsFilters => {
  const record = isRecord(value) ? value : {}

  return {
    branch: toOptionalString(record.branch) ?? undefined,
    dateFrom: toOptionalString(record.dateFrom) ?? undefined,
    dateTo: toOptionalString(record.dateTo) ?? undefined,
    environment: toOptionalString(record.environment) ?? undefined,
    status: toOptionalString(record.status) ?? undefined,
    tags: toStringArray(record.tags),
  }
}

const normalizeTrendPoint = (value: unknown): DashboardPassFailTrendPoint => {
  const record = isRecord(value) ? value : {}

  return {
    broken: toNumber(record.broken),
    date: toStringValue(record.date),
    failed: toNumber(record.failed),
    passed: toNumber(record.passed),
    skipped: toNumber(record.skipped),
    total: toNumber(record.total),
  }
}

const normalizeFailingTest = (value: unknown): DashboardTopFailingTest => {
  const record = isRecord(value) ? value : {}

  return {
    failures: toNumber(record.failures),
    flakyRuns: toNumber(record.flakyRuns),
    lastRunAt: toOptionalString(record.lastRunAt) ?? undefined,
    lastStatus: toStringValue(record.lastStatus, 'unknown'),
    name: toStringValue(record.name, 'Unnamed test'),
  }
}

const normalizeFailingSuite = (value: unknown): DashboardTopFailingSuite => {
  const record = isRecord(value) ? value : {}

  return {
    failures: toNumber(record.failures),
    name: toStringValue(record.name, 'Unnamed suite'),
    tests: toNumber(record.tests),
  }
}

const normalizeDashboardSummary = (value: unknown): DashboardMetricsSummary => {
  const record = isRecord(value) ? value : {}

  return {
    broken: toNumber(record.broken),
    failed: toNumber(record.failed),
    passRate: toNumber(record.passRate),
    passed: toNumber(record.passed),
    skipped: toNumber(record.skipped),
    totalRuns: toNumber(record.totalRuns),
    totalTests: toNumber(record.totalTests),
  }
}

const normalizeDashboardCache = (value: unknown): DashboardMetricsCache | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  return {
    expiresAt: toStringValue(value.expiresAt),
    generatedAt: toStringValue(value.generatedAt),
    hit: Boolean(value.hit),
    key: toStringValue(value.key),
    ttlSeconds: toNumber(value.ttlSeconds),
  }
}

const normalizeDashboardMetrics = (value: unknown): DashboardMetricsResponse => {
  const record = isRecord(value) ? value : {}
  const flakyRate = isRecord(record.flakyRate) ? record.flakyRate : {}

  return {
    cache: normalizeDashboardCache(record.cache),
    filters: normalizeDashboardMetricsFilters(record.filters),
    flakyRate: {
      flakyTests: toNumber(flakyRate.flakyTests),
      percentage: toNumber(flakyRate.percentage),
      trackedTests: toNumber(flakyRate.trackedTests),
    },
    passFailTrend: Array.isArray(record.passFailTrend) ? record.passFailTrend.map(normalizeTrendPoint) : [],
    summary: normalizeDashboardSummary(record.summary),
    topFailingSuites: Array.isArray(record.topFailingSuites)
      ? record.topFailingSuites.map(normalizeFailingSuite)
      : [],
    topFailingTests: Array.isArray(record.topFailingTests)
      ? record.topFailingTests.map(normalizeFailingTest)
      : [],
  }
}

const buildSearchParams = (entries: Array<[string, null | number | string | undefined]>) => {
  const searchParams = new URLSearchParams()

  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === '') {
      continue
    }

    searchParams.set(key, String(value))
  }

  return searchParams.toString()
}

const projectApiPath = (projectId: string) => `/api/v1/projects/${encodeProjectId(projectId)}`

export const queryKeys = {
  aiCapabilities: () => ['ai-analysis', 'capabilities'] as const,
  projectDashboard: (projectId: string) => ['projects', normalizeProjectId(projectId), 'dashboard'] as const,
  projectDashboardMeta: (projectId: string) =>
    [...queryKeys.projectDashboard(projectId), 'meta'] as const,
  projectDashboardMetrics: (projectId: string) =>
    [...queryKeys.projectDashboard(projectId), 'metrics'] as const,
  projectDashboards: (projectId: string) =>
    [...queryKeys.projectDashboard(projectId), 'state'] as const,
  projectLaunch: (projectId: string, launchId: string) =>
    ['projects', normalizeProjectId(projectId), 'launches', String(launchId)] as const,
  projectLaunchResults: (projectId: string, launchId: string) =>
    [...queryKeys.projectLaunch(projectId, launchId), 'results'] as const,
  projectLaunches: (projectId: string) => ['projects', normalizeProjectId(projectId), 'launches'] as const,
  projects: () => ['projects'] as const,
  settingsLogo: () => ['settings', 'logo'] as const,
}

export const invalidateProjectRunQueries = async (
  queryClient: QueryClient,
  projectId: string,
  launchId?: string,
) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.projectLaunches(projectId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.projectDashboard(projectId) }),
    launchId ? queryClient.invalidateQueries({ queryKey: queryKeys.projectLaunch(projectId, launchId) }) : Promise.resolve(),
    launchId
      ? queryClient.invalidateQueries({ queryKey: queryKeys.projectLaunchResults(projectId, launchId) })
      : Promise.resolve(),
  ])
}

export const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      mutations: {
        retry: 0,
      },
      queries: {
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000,
      },
    },
  })

export const getProjectsQueryOptions = (apiClient: ApiClient) =>
  queryOptions({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>('/api/v1/projects?includeArchived=true')
      const source = unwrapApiData(payload)

      if (!Array.isArray(source)) {
        return []
      }

      return source.map(normalizeProjectSummary)
    },
    queryKey: queryKeys.projects(),
    staleTime: 60_000,
  })

export const getLogoQueryOptions = (apiClient: ApiClient) =>
  queryOptions({
    queryFn: async () => {
      try {
        const payload = await apiClient.get<unknown>('/api/v1/settings/branding/logo')
        const source = unwrapApiData(payload)

        if (isRecord(source) && typeof source.value === 'string' && source.value.trim()) {
          return source.value
        }

        return null
      } catch {
        return null
      }
    },
    queryKey: queryKeys.settingsLogo(),
    staleTime: 5 * 60_000,
  })

export const getCapabilitiesQueryOptions = (apiClient: ApiClient) =>
  queryOptions({
    queryFn: async () => {
      const payload = await apiClient.get<AiAnalysisCapabilitiesResponse>('/api/v1/ai/capabilities')
      return unwrapApiData(payload)
    },
    queryKey: queryKeys.aiCapabilities(),
    staleTime: 60_000,
  })

export const getAiLicenseConfigQueryOptions = (apiClient: ApiClient) =>
  queryOptions({
    queryFn: async () => {
      const [modePayload, licensePayload] = await Promise.all([
        apiClient.get<unknown>('/api/v1/settings/aiAnalysisMode'),
        apiClient.get<unknown>('/api/v1/settings/aiAnalysisLicense'),
      ])

      const modeData = unwrapApiData(modePayload)
      const licenseData = unwrapApiData(licensePayload)
      const rawLicenseValue = isRecord(licenseData) ? licenseData.value : null
      const signedLicense =
        isRecord(rawLicenseValue) && isRecord(rawLicenseValue.payload) ? rawLicenseValue : null
      const payload = signedLicense && isRecord(signedLicense.payload) ? signedLicense.payload : null

      return {
        hasStoredLicense:
          isRecord(licenseData) &&
          (typeof licenseData.value === 'string'
            ? licenseData.value.trim().length > 0
            : isRecord(licenseData.value)),
        license:
          payload &&
          typeof payload.licenseId === 'string' &&
          typeof payload.customer === 'string' &&
          typeof payload.issuedAt === 'string'
            ? {
                customer: payload.customer,
                expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : null,
                issuedAt: payload.issuedAt,
                licenseId: payload.licenseId,
              }
            : null,
        mode:
          isRecord(modeData) && typeof modeData.value === 'string'
            ? modeData.value.trim()
            : '',
      }
    },
    queryKey: ['ai-analysis', 'license-config'],
    staleTime: 60_000,
  })

export const getProjectDashboardsQueryOptions = (apiClient: ApiClient, projectId: string) =>
  queryOptions({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>(`${projectApiPath(projectId)}/dashboards`)
      return normalizeDashboardState(unwrapApiData(payload))
    },
    queryKey: queryKeys.projectDashboards(projectId),
  })

export const getProjectDashboardMetaQueryOptions = (apiClient: ApiClient, projectId: string) =>
  queryOptions({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>(`${projectApiPath(projectId)}/dashboard-metrics/meta`)
      return normalizeDashboardMeta(unwrapApiData(payload))
    },
    queryKey: queryKeys.projectDashboardMeta(projectId),
    staleTime: 5 * 60_000,
  })

export const getProjectDashboardMetricsQueryOptions = (
  apiClient: ApiClient,
  projectId: string,
  search: DashboardMetricsSearch,
) => {
  const queryString = buildSearchParams([
    ['branch', search.branch],
    ['dateFrom', search.dateFrom],
    ['dateTo', search.dateTo],
    ['environment', search.environment],
    ['status', search.status],
    ['tags', search.tags],
  ])
  const path = `${projectApiPath(projectId)}/dashboard-metrics${queryString ? `?${queryString}` : ''}`

  return queryOptions({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>(path)
      return normalizeDashboardMetrics(unwrapApiData(payload))
    },
    queryKey: [...queryKeys.projectDashboardMetrics(projectId), search],
  })
}

export const getProjectLaunchesQueryOptions = (
  apiClient: ApiClient,
  projectId: string,
  search: LaunchesListSearch,
) => {
  const queryString = buildSearchParams([
    ['branch', search.branch],
    ['dateFrom', search.dateFrom],
    ['dateTo', search.dateTo],
    ['limit', search.limit],
    ['page', search.page],
    ['search', search.search],
    ['sortBy', search.sortBy],
    ['sortOrder', search.sortOrder],
    ['status', search.status],
  ])

  return queryOptions({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>(`${projectApiPath(projectId)}/runs?${queryString}`)
      const source = unwrapApiData(payload)
      const record = isRecord(source) ? source : {}
      const normalized = runsListResponseSchema.parse({
        items: Array.isArray(record.items) ? record.items.map((item) => runSchema.parse(item)) : [],
        limit: toNumber(record.limit, search.limit),
        page: toNumber(record.page, search.page),
        total: toNumber(record.total, Array.isArray(record.items) ? record.items.length : 0),
      })

      return {
        ...normalized,
        items: normalized.items.map(normalizeContractRun),
      }
    },
    queryKey: [...queryKeys.projectLaunches(projectId), search],
    placeholderData: (previous) => previous,
  })
}

export const getProjectRecentLaunchesQueryOptions = (
  apiClient: ApiClient,
  projectId: string,
  status?: DashboardMetricsSearch['status'],
) =>
  queryOptions({
    queryFn: async () => {
      const queryString = buildSearchParams([
        ['limit', 5],
        ['page', 1],
        ['sortBy', 'startTime'],
        ['sortOrder', 'desc'],
        ['status', status],
      ])
      const payload = await apiClient.get<unknown>(`${projectApiPath(projectId)}/runs?${queryString}`)
      const source = unwrapApiData(payload)
      const record = isRecord(source) ? source : {}
      return Array.isArray(record.items) ? record.items.map(normalizeRun) : []
    },
    queryKey: [...queryKeys.projectLaunches(projectId), 'recent', status ?? 'all'],
  })

export const getProjectLaunchQueryOptions = (apiClient: ApiClient, projectId: string, launchId: string) =>
  queryOptions({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>(
        `${projectApiPath(projectId)}/runs/${encodeURIComponent(launchId)}`,
      )
      return normalizeRun(unwrapApiData(payload))
    },
    queryKey: queryKeys.projectLaunch(projectId, launchId),
  })

export const createProjectRun = async (
  apiClient: ApiClient,
  projectId: string,
  input: CreateRunRequest,
) => {
  const payload = await apiClient.post<unknown>(
    `${projectApiPath(projectId)}/runs`,
    createRunRequestSchema.parse(input),
  )

  return normalizeRun(unwrapApiData(payload))
}

export const completeProjectRun = async (apiClient: ApiClient, projectId: string, launchId: string) => {
  const payload = await apiClient.post<unknown>(
    `${projectApiPath(projectId)}/runs/${encodeURIComponent(launchId)}/complete`,
  )

  return normalizeRun(unwrapApiData(payload))
}

export const importProjectAllureResultsFromPath = async (
  apiClient: ApiClient,
  projectId: string,
  input: {
    branch?: string
    directoryPath: string
    environment?: string
    parentRunId?: string
    runName?: string
    tags?: string[]
  },
) => {
  const payload = await apiClient.post<unknown>(
    `${projectApiPath(projectId)}/imports/allure-jobs`,
    createAllureImportJobRequestSchema.parse({
      run: {
        branch: input.branch,
        environment: input.environment,
        parentRunId: input.parentRunId,
        runName: input.runName,
        tags: input.tags,
      },
      source: {
        directoryPath: input.directoryPath,
        kind: 'directory_path',
      },
    }),
  )

  return normalizeAllureImportJobResult(unwrapApiData(payload))
}

export const importProjectAllureResultsFromUpload = async (
  apiClient: ApiClient,
  projectId: string,
  input: {
    branch?: string
    environment?: string
    files: File[]
    parentRunId?: string
    runName?: string
    sourceKind: 'ci_archive' | 'uploaded_batch' | 'uploaded_file'
    tags?: string[]
  },
) => {
  const normalized = createAllureImportJobFormSchema.parse({
    branch: input.branch,
    environment: input.environment,
    parentRunId: input.parentRunId,
    runName: input.runName,
    sourceKind: input.sourceKind,
    tags: input.tags,
  })

  const formData = new FormData()

  input.files.forEach((file) => {
    formData.append('file', file)
  })

  if (normalized.branch) {
    formData.append('branch', normalized.branch)
  }
  if (normalized.environment) {
    formData.append('environment', normalized.environment)
  }
  if (normalized.parentRunId) {
    formData.append('parentRunId', normalized.parentRunId)
  }
  if (normalized.runName) {
    formData.append('runName', normalized.runName)
  }
  if (normalized.sourceKind) {
    formData.append('sourceKind', normalized.sourceKind)
  }
  if (normalized.tags && normalized.tags.length > 0) {
    formData.append('tags', JSON.stringify(normalized.tags))
  }

  const payload = await apiClient.upload<unknown>(`${projectApiPath(projectId)}/imports/allure-jobs`, formData)

  return normalizeAllureImportJobResult(unwrapApiData(payload))
}

export const getProjectLaunchResultsQueryOptions = (
  apiClient: ApiClient,
  projectId: string,
  launchId: string,
) =>
  queryOptions({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>(
        `${projectApiPath(projectId)}/runs/${encodeURIComponent(launchId)}/results`,
      )
      return normalizeResultsResponse(unwrapApiData(payload))
    },
    queryKey: queryKeys.projectLaunchResults(projectId, launchId),
  })

export const resolveCanonicalProjectId = async ({
  apiClient,
  preferredProjectId,
  queryClient,
}: {
  apiClient: ApiClient
  preferredProjectId?: string | null
  queryClient: QueryClient
}) => {
  const projects = await queryClient.ensureQueryData(getProjectsQueryOptions(apiClient))
  return resolvePreferredProjectId(projects, preferredProjectId)
}
