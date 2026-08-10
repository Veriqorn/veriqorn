export interface User {
  avatar?: null | string
  email: string
  id: string
  name: string
  role: 'admin' | 'kb_viewer' | 'user'
}

export interface ProjectSummary {
  createdAt: string
  description: null | string
  id: string
  isArchived: boolean
  isDefault: boolean
  key: string
  name: string
  updatedAt: string
}

export type ProjectRole = 'owner' | 'maintainer' | 'viewer'

export interface ProjectMembership {
  createdAt: string
  projectId: string
  projectName: string
  projectRole: ProjectRole
  updatedAt: string
  userEmail: string
  userId: number
  userName: string
}

export interface UserProjectAccess {
  memberships: Array<{
    isArchived: boolean
    projectId: string
    projectName: string
    projectRole: ProjectRole
  }>
  platformRole: 'admin' | 'user'
  userEmail: string
  userId: number
  userName: string
}

export interface AiAnalysisCapabilitiesResponse {
  features: Record<string, { enabled: boolean; reason?: string }>
  license: null | {
    customer: string
    expiresAt: null | string
    issuedAt: string
    licenseId: string
  }
  licensed: boolean
  message: string
  mode: string
  status: string
  upgradeUrl: null | string
}

export interface TestRunStats {
  broken: number
  failed: number
  passRate: number
  passed: number
  skipped: number
  total: number
}

export interface TestRun {
  branch: null | string
  endTime: null | string
  environment: null | string
  id: string
  name: string
  projectId: null | string
  startTime: null | string
  stats: TestRunStats
  status: string
  tags: string[]
  uuid?: string
}

export interface TestAttachment {
  id: string
  isTrace?: boolean
  name: string
  source: string
  traceAssetUrl?: string
  traceTokenExpiresAt?: string
  traceViewerUrl?: string
  type: string
}

export interface TestStep {
  attachments: TestAttachment[]
  childSteps: TestStep[]
  endTime?: string
  id: string
  name: string
  parameters?: unknown
  stage?: string
  startTime?: string
  status?: string
  statusDetails?: {
    message?: string
    trace?: string
  }
}

export interface TestResultLabel {
  name: string
  value: string
}

export interface TestResultDiagnostics {
  failedStepName?: string
  hasAttachments?: boolean
  message?: string
  stackTrace?: string
  status?: string
}

export interface TestResultHistoryItem {
  duration?: number
  endTime?: string
  id: string
  startTime: string
  status: string
  testRunId?: string
  uuid?: string
}

export interface TestResult {
  allureId?: null | string
  diagnostics?: TestResultDiagnostics
  duration: number
  endTime?: string
  history: TestResultHistoryItem[]
  historyId?: string
  id: string
  labels: TestResultLabel[]
  name: string
  parameters?: unknown
  retries: TestResultHistoryItem[]
  startTime?: string
  status: string
  steps: TestStep[]
  totalAttachments: number
  uuid?: string
}

export interface TestResultsMeta {
  brokenCount: number
  failedCount: number
  generatedAt: string
  passedCount: number
  runId: string
  skippedCount: number
  totalAttachments: number
  totalResults: number
}

export interface TestResultsResponse {
  items: TestResult[]
  meta: TestResultsMeta
  total: number
}

export interface DashboardWidgetLayout {
  h: number
  w: number
  x: number
  y: number
}

export interface DashboardWidget {
  dataSource: string
  id: string
  layout?: DashboardWidgetLayout
  title: string
  visualization: string
}

export interface DashboardConfig {
  id: string
  isDefault: boolean
  name: string
  order: number
  updatedAt: string
  widgets: DashboardWidget[]
}

export interface DashboardState {
  dashboards: DashboardConfig[]
}

export interface DashboardMetaOption {
  id: string
  label: string
}

export interface DashboardMeta {
  dataSources: DashboardMetaOption[]
  visualizations: DashboardMetaOption[]
}

export interface DashboardMetricsFilters {
  branch?: string
  dateFrom?: string
  dateTo?: string
  environment?: string
  status?: string
  tags?: string[]
}

export interface DashboardPassFailTrendPoint {
  broken: number
  date: string
  failed: number
  passed: number
  skipped: number
  total: number
}

export interface DashboardTopFailingTest {
  failures: number
  flakyRuns: number
  lastRunAt?: string
  lastStatus: string
  name: string
}

export interface DashboardTopFailingSuite {
  failures: number
  name: string
  tests: number
}

export interface DashboardMetricsSummary {
  broken: number
  failed: number
  passRate: number
  passed: number
  skipped: number
  totalRuns: number
  totalTests: number
}

export interface DashboardMetricsCache {
  expiresAt: string
  generatedAt: string
  hit: boolean
  key: string
  ttlSeconds: number
}

export interface DashboardMetricsResponse {
  cache?: DashboardMetricsCache
  filters: DashboardMetricsFilters
  flakyRate: {
    flakyTests: number
    percentage: number
    trackedTests: number
  }
  passFailTrend: DashboardPassFailTrendPoint[]
  summary: DashboardMetricsSummary
  topFailingSuites: DashboardTopFailingSuite[]
  topFailingTests: DashboardTopFailingTest[]
}
