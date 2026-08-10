import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import type { ApiClient } from '@/lib/api'
import { getLogoQueryOptions, getProjectsQueryOptions, queryKeys } from '@/lib/queries'
import {
  normalizeProjectId,
  persistActiveProjectId,
  resolvePreferredProjectId,
  resolveStoredProjectId,
} from '@/lib/project-paths'
import { useAuth } from '@/providers/auth-provider'
import type { ProjectSummary } from '@/types'

interface SettingsContextValue {
  activeProjectId: string
  logoUrl: string | null
  projects: ProjectSummary[]
  refreshProjects: () => Promise<void>
  setActiveProjectId: (projectId: string) => void
}

const EMPTY_PROJECTS: ProjectSummary[] = []

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ apiClient, children }: { apiClient: ApiClient; children: ReactNode }) {
  const queryClient = useQueryClient()
  const { status } = useAuth()
  const [activeProjectId, setActiveProjectIdState] = useState(resolveStoredProjectId)
  const isAuthenticated = status === 'authenticated'

  const projectsQuery = useQuery({
    ...getProjectsQueryOptions(apiClient),
    enabled: isAuthenticated,
  })
  const logoQuery = useQuery({
    ...getLogoQueryOptions(apiClient),
    enabled: isAuthenticated,
  })

  const projects = projectsQuery.data ?? EMPTY_PROJECTS
  const resolvedActiveProjectId =
    projects.length > 0 ? resolvePreferredProjectId(projects, activeProjectId) : activeProjectId

  useEffect(() => {
    persistActiveProjectId(resolvedActiveProjectId)
  }, [resolvedActiveProjectId])

  const setActiveProjectId = useCallback((projectId: string) => {
    const normalizedProjectId = normalizeProjectId(projectId)
    setActiveProjectIdState(normalizedProjectId)
    persistActiveProjectId(normalizedProjectId)
  }, [])

  const refreshProjects = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
  }, [queryClient])

  const value = useMemo<SettingsContextValue>(
    () => ({
      activeProjectId: resolvedActiveProjectId,
      logoUrl: logoQuery.data ?? null,
      projects,
      refreshProjects,
      setActiveProjectId,
    }),
    [logoQuery.data, projects, refreshProjects, resolvedActiveProjectId, setActiveProjectId],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const context = useContext(SettingsContext)

  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider.')
  }

  return context
}
