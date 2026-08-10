import {
  dashboardMetricsSearchSchema,
  launchDetailsSearchSchema,
  launchesListSearchSchema,
  loginSearchSchema,
  settingsSearchSchema,
  testResultsSearchSchema,
  type DashboardMetricsSearch as ContractDashboardMetricsSearch,
  type LaunchDetailsSearch as ContractLaunchDetailsSearch,
  type LaunchesListSearch as ContractLaunchesListSearch,
  type LoginSearch as ContractLoginSearch,
  type SettingsSearch as ContractSettingsSearch,
  type SettingsSection as ContractSettingsSection,
  type TestResultsSearch as ContractTestResultsSearch,
  type TestResultsView as ContractTestResultsView,
} from '@veriqorn/contracts'

type LaunchDetailTab = NonNullable<ContractLaunchDetailsSearch['tab']>
type TestResultsTab = ContractTestResultsView

export type SettingsSection = ContractSettingsSection
export type LaunchStatusFilter = ContractLaunchesListSearch['status']
export type LoginSearch = ContractLoginSearch
export type LaunchesSearch = ContractLaunchesListSearch
export type DashboardSearch = ContractDashboardMetricsSearch
export type LaunchDetailSearch = ContractLaunchDetailsSearch & { tab: LaunchDetailTab }
export type TestResultsSearch = ContractTestResultsSearch & { tab: TestResultsTab }
export type SettingsSearch = ContractSettingsSearch

export const defaultDashboardSearch: DashboardSearch = {
  refresh: false,
}

export const defaultLaunchesSearch: LaunchesSearch = {
  limit: 10,
  page: 1,
  sortBy: 'startTime',
  sortOrder: 'desc',
}

const normalizeOptionalText = (value?: string) => {
  const normalizedValue = value?.trim()
  return normalizedValue ? normalizedValue : undefined
}

export const validateLoginSearch = (value: unknown): LoginSearch => {
  const parsed = loginSearchSchema.safeParse(value)
  const redirectTo = parsed.success ? parsed.data.redirectTo : undefined

  return {
    redirectTo: redirectTo?.startsWith('/') ? redirectTo : undefined,
  }
}

export const validateSettingsSearch = (value: unknown): SettingsSearch => {
  const parsed = settingsSearchSchema.safeParse(value)
  return parsed.success ? parsed.data : { section: 'general' }
}

export const validateLaunchesSearch = (value: unknown): LaunchesSearch => {
  const parsed = launchesListSearchSchema.safeParse(value)
  const data = parsed.success ? parsed.data : defaultLaunchesSearch

  return {
    ...data,
    branch: normalizeOptionalText(data.branch),
    dateFrom: normalizeOptionalText(data.dateFrom),
    dateTo: normalizeOptionalText(data.dateTo),
    search: normalizeOptionalText(data.search),
  }
}

export const validateDashboardSearch = (value: unknown): DashboardSearch => {
  const parsed = dashboardMetricsSearchSchema.safeParse(value)
  const data: DashboardSearch = parsed.success ? parsed.data : defaultDashboardSearch

  return {
    ...data,
    branch: normalizeOptionalText(data.branch),
    dateFrom: normalizeOptionalText(data.dateFrom),
    dateTo: normalizeOptionalText(data.dateTo),
    environment: normalizeOptionalText(data.environment),
    refresh: data.refresh,
    status: normalizeOptionalText(data.status),
    tags: normalizeOptionalText(data.tags),
  }
}

export const validateLaunchDetailSearch = (value: unknown): LaunchDetailSearch => {
  const parsed = launchDetailsSearchSchema.safeParse(value)
  const resultId = parsed.success ? normalizeOptionalText(parsed.data.resultId) : undefined
  const status = parsed.success ? normalizeOptionalText(parsed.data.status) : undefined
  const tab = parsed.success && parsed.data.tab ? parsed.data.tab : resultId ? 'tests' : 'overview'

  return {
    resultId,
    status: status as LaunchDetailSearch['status'],
    tab,
  }
}

export const validateTestResultsSearch = (value: unknown): TestResultsSearch => {
  const parsed = testResultsSearchSchema.safeParse(value)
  const data = parsed.success ? parsed.data : { tab: 'tests' as const }

  return {
    resultId: normalizeOptionalText(data.resultId),
    tab: data.tab,
  }
}
