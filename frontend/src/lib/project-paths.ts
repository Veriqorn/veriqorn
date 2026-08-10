import type { ProjectSummary } from '@/types'

export const ACTIVE_PROJECT_STORAGE_KEY = 'veriqorn.activeProjectId'
export const DEFAULT_PROJECT_ID = 'default'

export const normalizeProjectId = (value?: number | string | null) => {
  const rawValue = String(value ?? '').trim()

  if (!rawValue) {
    return DEFAULT_PROJECT_ID
  }

  try {
    return decodeURIComponent(rawValue)
  } catch {
    return rawValue
  }
}

export const encodeProjectId = (projectId: string) => encodeURIComponent(normalizeProjectId(projectId))

export const buildProjectDashboardPath = (projectId: string) =>
  `/projects/${encodeProjectId(projectId)}/dashboard`

export const buildProjectLaunchesPath = (projectId: string) =>
  `/projects/${encodeProjectId(projectId)}/launches`

export const buildProjectLaunchDetailPath = (projectId: string, launchId: string) =>
  `/projects/${encodeProjectId(projectId)}/launches/${encodeURIComponent(launchId)}`

export const buildProjectCoveragePath = (projectId: string) =>
  `/projects/${encodeProjectId(projectId)}/coverage`

export const extractProjectIdFromPath = (pathname: string) => {
  const match = pathname.match(/^\/projects\/([^/]+)/)
  return match ? normalizeProjectId(match[1]) : null
}

export const stripProjectScopePrefix = (pathname: string) => {
  const withoutScope = pathname.replace(/^\/projects\/[^/]+/, '')
  return withoutScope || '/'
}

export const replaceProjectScope = (pathname: string, projectId: string) => {
  if (!pathname.startsWith('/projects/')) {
    return buildProjectDashboardPath(projectId)
  }

  return pathname.replace(/^\/projects\/[^/]+/, `/projects/${encodeProjectId(projectId)}`)
}

export const persistActiveProjectId = (projectId: string) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, normalizeProjectId(projectId))
}

export const resolveStoredProjectId = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_PROJECT_ID
  }

  return normalizeProjectId(window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY))
}

export const resolvePreferredProjectId = (projects: ProjectSummary[], candidate?: string | null) => {
  const normalizedCandidate = normalizeProjectId(candidate)
  const activeCandidate = projects.find(
    (project) => !project.isArchived && normalizeProjectId(project.id) === normalizedCandidate,
  )

  if (activeCandidate) {
    return normalizeProjectId(activeCandidate.id)
  }

  const defaultProject = projects.find((project) => project.isDefault && !project.isArchived)
  if (defaultProject) {
    return normalizeProjectId(defaultProject.id)
  }

  const firstProject = projects.find((project) => !project.isArchived)
  if (firstProject) {
    return normalizeProjectId(firstProject.id)
  }

  return normalizedCandidate
}
