import { describe, expect, it } from 'vitest'

import {
  buildProjectDashboardPath,
  normalizeProjectId,
  replaceProjectScope,
  resolvePreferredProjectId,
  stripProjectScopePrefix,
} from '@/lib/project-paths'

describe('project path helpers', () => {
  it('normalizes missing and encoded project ids', () => {
    expect(normalizeProjectId()).toBe('default')
    expect(normalizeProjectId('qa%2Fteam')).toBe('qa/team')
  })

  it('replaces the current project scope and falls back to the dashboard for unscoped paths', () => {
    expect(replaceProjectScope('/projects/legacy/launches', 'qa/team')).toBe('/projects/qa%2Fteam/launches')
    expect(replaceProjectScope('/settings', 'qa/team')).toBe(buildProjectDashboardPath('qa/team'))
  })

  it('strips project scope prefixes without dropping the remaining route', () => {
    expect(stripProjectScopePrefix('/projects/demo/coverage')).toBe('/coverage')
    expect(stripProjectScopePrefix('/projects/demo')).toBe('/')
  })

  it('prefers the active project, then the default project, then the first non-archived project', () => {
    const projects = [
      { id: 'archived', isArchived: true, isDefault: false },
      { id: 'default-project', isArchived: false, isDefault: true },
      { id: 'fallback-project', isArchived: false, isDefault: false },
    ]

    expect(resolvePreferredProjectId(projects as never, 'fallback-project')).toBe('fallback-project')
    expect(resolvePreferredProjectId(projects as never, 'archived')).toBe('default-project')
    expect(resolvePreferredProjectId([{ id: 'archived', isArchived: true, isDefault: false }] as never, null)).toBe(
      'default',
    )
  })
})
