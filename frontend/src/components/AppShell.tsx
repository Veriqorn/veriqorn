import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Rocket,
  Settings,
  User,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import frontendPackage from '../../package.json'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { sidebarNavigation } from '@/features/navigation/navigation'
import { isFrontendContributionEntitled, loadFrontendExtensions, navigationContributions, type LoadedFrontendExtension } from '@/extensions/registry'
import { getAiLicenseConfigQueryOptions, getCapabilitiesQueryOptions } from '@/lib/queries'
import {

  buildProjectLaunchesPath,
  encodeProjectId,
  extractProjectIdFromPath,
  normalizeProjectId,
  replaceProjectScope,
  stripProjectScopePrefix,
} from '@/lib/project-paths'
import { cn } from '@/lib/utils'
import { useAuth } from '@/providers/auth-provider'
import { PageActionsSlot } from '@/providers/page-actions-provider'
import { useRuntime } from '@/providers/runtime-provider'
import { useSettings } from '@/providers/settings-provider'
import { defaultDashboardSearch, defaultLaunchesSearch } from '@/router/search'

const iconMap = {
  Bot,
  LayoutDashboard,
  Rocket,
  Settings,
} as const

const resolveShellMeta = (pathname: string) => {
  const scopedPath = stripProjectScopePrefix(pathname)

  if (scopedPath === '/dashboard') {
    return { eyebrow: null, title: 'Dashboard' }
  }
  if (scopedPath === '/launches') {
    return { eyebrow: null, title: 'Launches' }
  }
  if (/^\/launches\/[^/]+\/results$/.test(scopedPath)) {
    return { eyebrow: null, title: 'Test results' }
  }
  if (scopedPath.startsWith('/launches/')) {
    return { eyebrow: null, title: 'Launch detail' }
  }
  if (pathname.startsWith('/settings')) {
    return { eyebrow: null, title: 'Settings' }
  }
  if (pathname === '/profile') {
    return { eyebrow: null, title: 'Profile' }
  }
  return { eyebrow: null, title: 'Veriqorn' }
}

const isNavigationItemActive = (pathname: string, itemId: string) => {
  const scopedPath = stripProjectScopePrefix(pathname)

  if (itemId === 'overview') {
    return scopedPath === '/dashboard'
  }

  if (itemId === 'launches') {
    return scopedPath === '/launches' || scopedPath.startsWith('/launches/')
  }

  if (itemId === 'settings') {
    return pathname.startsWith('/settings')
  }

  return false
}

const getUserInitials = (name?: string | null) => {
  if (!name) {
    return 'U'
  }

  const [first = '', second = ''] = name.trim().split(/\s+/, 2)
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || first.charAt(0).toUpperCase() || 'U'
}

const resolveProjectSwitchTarget = (pathname: string, projectId: string) => {
  const scopedPath = stripProjectScopePrefix(pathname)

  if (scopedPath.startsWith('/launches/')) {
    return {
      href: buildProjectLaunchesPath(projectId),
      preserveSearch: false,
    }
  }

  return {
    href: replaceProjectScope(pathname, projectId),
    preserveSearch: true,
  }
}

export function AppShell() {
  const { apiClient } = useRuntime()
  const { logout, user } = useAuth()
  const { activeProjectId, logoUrl, projects, setActiveProjectId } = useSettings()
  const location = useRouterState({ select: (state) => state.location })
  const navigate = useNavigate()
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [frontendExtensions, setFrontendExtensions] = useState<LoadedFrontendExtension[]>([])

  const capabilitiesQuery = useQuery(getCapabilitiesQueryOptions(apiClient))
  const licenseConfigQuery = useQuery(getAiLicenseConfigQueryOptions(apiClient))
  const hasStoredProConfig =
    licenseConfigQuery.data?.mode === 'pro_self_hosted' &&
    licenseConfigQuery.data?.hasStoredLicense === true
  const isProLicensed = Boolean(capabilitiesQuery.data?.licensed) || hasStoredProConfig
  const routeProjectId = extractProjectIdFromPath(location.pathname)
  const currentProjectId = normalizeProjectId(routeProjectId ?? activeProjectId)
  const currentProject = useMemo(
    () => projects.find((project) => normalizeProjectId(project.id) === normalizeProjectId(currentProjectId)),
    [currentProjectId, projects],
  )

  useEffect(() => {
    globalThis.__VERIQORN_FRONTEND_EXTENSION_HOST__ = {
      activeProjectId: currentProjectId || null,
      api: { request: apiClient.request },
      isProLicensed,
      user: user ? { id: user.id, name: user.name, role: user.role } : null,
    }
    return () => { delete globalThis.__VERIQORN_FRONTEND_EXTENSION_HOST__ }
  }, [apiClient.request, currentProjectId, isProLicensed, user])

  useEffect(() => {
    if (routeProjectId && routeProjectId !== activeProjectId) {
      setActiveProjectId(routeProjectId)
    }
  }, [activeProjectId, routeProjectId, setActiveProjectId])

  useEffect(() => {
    let active = true
    loadFrontendExtensions()
      .then((extensions) => { if (active) setFrontendExtensions(extensions) })
      .catch(() => { if (active) setFrontendExtensions([]) })
    return () => { active = false }
  }, [])

  const visibleNavigation = sidebarNavigation.filter((item) => !item.requiresPro || isProLicensed)
  const visibleExtensionNavigation = navigationContributions(frontendExtensions)
    .filter((item) => isFrontendContributionEntitled(item.requiredEntitlement, isProLicensed))
  const selectableProjects = projects.filter((project) => !project.isArchived)
  const shellMeta = resolveShellMeta(location.pathname)
  const showExpandedContent = !isSidebarCollapsed || isMobileNavOpen
  const appVersion = frontendPackage.version
  const handleProjectChange = async (nextProjectId: string) => {
    const normalizedNextProjectId = normalizeProjectId(nextProjectId)
    setActiveProjectId(normalizedNextProjectId)

    if (!routeProjectId) {
      return
    }

    const target = resolveProjectSwitchTarget(location.pathname, normalizedNextProjectId)
    const nextHref = `${target.href}${target.preserveSearch && location.searchStr ? `?${location.searchStr}` : ''}`
    await navigate({ href: nextHref })
  }

  const handleLogout = async () => {
    await logout()
    await navigate({ replace: true, to: '/login' })
  }

  return (
    <div className="min-h-screen lg:flex" data-testid="dashboard-shell">
      {isMobileNavOpen ? (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-[rgba(7,11,18,0.45)] backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileNavOpen(false)}
          type="button"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[20.5rem] flex-col border-r border-white/10 bg-sidebar text-sidebar-foreground shadow-[28px_0_90px_rgba(9,16,30,0.28)] transition-[transform,width] duration-300 lg:sticky lg:top-0 lg:z-20 lg:h-screen lg:translate-x-0',
          isMobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          isSidebarCollapsed ? 'lg:w-[5.5rem]' : 'lg:w-[20.5rem]',
        )}
      >
        <div
          className={cn(
            'py-4',
            showExpandedContent ? 'flex items-start gap-3 px-4' : 'flex flex-col items-center gap-2 px-2.5',
          )}
        >
          <div className={cn('flex min-w-0 items-start gap-3', showExpandedContent ? 'flex-1' : 'flex-none')}>
            <div
              className={cn(
                'flex items-center justify-center overflow-hidden border border-white/12 bg-white/8 shadow-[0_12px_30px_rgba(7,11,18,0.22)] transition-all duration-200',
                showExpandedContent ? 'h-12 w-12 rounded-[1.1rem]' : 'h-10 w-10 rounded-[0.9rem]',
              )}
            >
              {logoUrl ? (
                <img alt="Veriqorn" className="h-full w-full object-cover" src={logoUrl} />
              ) : (
                <span className="text-sm font-semibold tracking-[0.24em] text-white/90">VQ</span>
              )}
            </div>
            {showExpandedContent ? (
              <div className="min-w-0 flex-1 pt-0.5">
                {selectableProjects.length > 0 ? (
                  <Select onValueChange={(value: string) => void handleProjectChange(value)} value={currentProjectId}>
                    <div className="flex min-w-0 max-w-[12.5rem] flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/42">
                        Project
                      </span>
                      <SelectTrigger
                        className="h-8 w-full justify-start rounded-none border-0 bg-transparent px-0 text-sidebar-foreground shadow-none focus:ring-0 focus:ring-offset-0"
                        data-testid="project-switcher-trigger"
                      >
                        <SelectValue
                          className="truncate text-[13px] font-medium tracking-[0.01em] text-white/78"
                          placeholder="Choose a project"
                        />
                      </SelectTrigger>
                    </div>
                    <SelectContent data-testid="project-switcher-menu">
                      {selectableProjects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs leading-6 text-sidebar-muted">No project context has been restored yet.</p>
                )}
              </div>
            ) : null}
          </div>

          <div className={cn('flex items-center gap-2', showExpandedContent ? '' : 'justify-center')}>
            <Button
              aria-label="Close sidebar"
              className="text-sidebar-muted hover:bg-white/10 hover:text-sidebar-foreground lg:hidden"
              onClick={() => setIsMobileNavOpen(false)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn(
                'hidden text-sidebar-muted hover:bg-white/10 hover:text-sidebar-foreground lg:inline-flex',
                !showExpandedContent && 'h-8 w-8',
              )}
              onClick={() => setIsSidebarCollapsed((current) => !current)}
              size="icon"
              type="button"
              variant="ghost"
            >
              {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <nav className="flex-1 px-3 pb-3">
          <div className="space-y-1">
            {visibleNavigation.map((item) => {
              const Icon = iconMap[item.icon]
              const active = isNavigationItemActive(location.pathname, item.id)
              const linkClassName = cn(
                'group flex items-center border border-transparent text-sm font-medium transition-all duration-200',
                showExpandedContent ? 'gap-3 rounded-[1rem] px-3 py-3' : 'mx-auto h-11 w-11 justify-center rounded-[1rem] px-0',
                active
                  ? 'border-white/12 bg-white/14 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                  : 'text-sidebar-muted hover:border-white/10 hover:bg-white/8 hover:text-sidebar-foreground',
              )

              if (item.id === 'settings') {
                return (
                  <Link
                    className={linkClassName}
                    key={item.id}
                    search={{ section: 'general' }}
                    title={showExpandedContent ? undefined : item.label}
                    to="/settings"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {showExpandedContent ? <span>{item.label}</span> : null}
                  </Link>
                )
              }

              if (item.id === 'overview') {
                return (
                  <Link
                    className={linkClassName}
                    key={item.id}
                    params={{ projectId: encodeProjectId(currentProjectId) }}
                    search={defaultDashboardSearch}
                    title={showExpandedContent ? undefined : item.label}
                    to="/projects/$projectId/dashboard"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {showExpandedContent ? <span>{item.label}</span> : null}
                  </Link>
                )
              }

              if (item.id === 'launches') {
                return (
                  <Link
                    className={linkClassName}
                    key={item.id}
                    params={{ projectId: encodeProjectId(currentProjectId) }}
                    search={defaultLaunchesSearch}
                    title={showExpandedContent ? undefined : item.label}
                    to="/projects/$projectId/launches"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {showExpandedContent ? <span>{item.label}</span> : null}
                  </Link>
                )
              }

              return null
            })}
            {visibleExtensionNavigation.map((item) => (
              <a
                className={cn(
                  'group flex items-center border border-transparent text-sm font-medium transition-all duration-200',
                  showExpandedContent ? 'gap-3 rounded-[1rem] px-3 py-3' : 'mx-auto h-11 w-11 justify-center rounded-[1rem] px-0',
                  location.pathname === item.href
                    ? 'border-white/12 bg-white/14 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                    : 'text-sidebar-muted hover:border-white/10 hover:bg-white/8 hover:text-sidebar-foreground',
                )}
                href={`${item.href}?projectId=${encodeURIComponent(currentProjectId)}`}
                key={`extension:${item.id}`}
                title={showExpandedContent ? undefined : item.label}
              >
                <Bot className="h-4 w-4 shrink-0" />
                {showExpandedContent ? <span>{item.label}</span> : null}
              </a>
            ))}
          </div>

        </nav>

        <div className="px-3 pb-3">
          <div
            className={cn(
              'rounded-[1rem] border border-white/6 bg-white/[0.035] px-3 py-2.5',
              !showExpandedContent && 'flex justify-center rounded-[999px] px-2 py-2',
            )}
          >
            {showExpandedContent ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-[0.01em] text-white/84">Veriqorn</p>
                </div>
                <span className="shrink-0 rounded-full border border-white/8 bg-white/6 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/58">
                  v{appVersion}
                </span>
              </div>
            ) : (
              <span
                className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-white/58"
                title={`Veriqorn v${appVersion}`}
              >
                v{appVersion}
              </span>
            )}
          </div>
        </div>

        <Separator className="bg-white/10" />

        <div className="p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'flex items-center gap-3 rounded-[1.2rem] text-left transition hover:bg-white/8',
                  showExpandedContent ? 'w-full px-3 py-3' : 'mx-auto h-12 w-12 justify-center px-0 py-0',
                )}
                title={showExpandedContent ? undefined : 'Open profile menu'}
                type="button"
              >
                <Avatar className={cn('border border-white/12 ring-1 ring-white/10', showExpandedContent ? 'h-11 w-11' : 'h-10 w-10')}>
                  <AvatarImage alt={user?.name ?? 'User'} src={user?.avatar ?? undefined} />
                  <AvatarFallback className="bg-white/12 text-white">{getUserInitials(user?.name)}</AvatarFallback>
                </Avatar>
                {showExpandedContent ? (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{user?.name ?? 'Unknown user'}</p>
                      <p className="truncate text-xs text-sidebar-muted">{user?.email ?? 'No email available'}</p>
                    </div>
                    <ChevronsUpDown className="h-4 w-4 text-sidebar-muted" />
                  </>
                ) : null}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64" side={showExpandedContent ? 'top' : 'right'} sideOffset={12}>
              <DropdownMenuLabel>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">{user?.name ?? 'Unknown user'}</p>
                  <p className="text-xs font-normal text-muted-foreground">{user?.email ?? 'No email available'}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate({ to: '/profile' })}>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate({ search: { section: 'general' }, to: '/settings' })}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void handleLogout()}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <main className="page-shell flex-1">
          <header className="surface-panel relative overflow-hidden px-6 py-6 sm:px-8">
            <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(90deg,rgba(17,109,240,0.12),rgba(255,197,104,0.12),transparent)]" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex items-start gap-3">
                <Button
                  aria-label="Open navigation"
                  className="mt-1 lg:hidden"
                  onClick={() => setIsMobileNavOpen(true)}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                    {shellMeta.title}
                  </h2>
                </div>
              </div>

              <PageActionsSlot
                fallback={
                  <>
                    {currentProject ? (
                      <Badge className="px-3 py-1" variant="outline">{currentProject.name}</Badge>
                    ) : null}
                    {isProLicensed ? (
                      <Badge className="px-3 py-1" variant="success">AI Pro</Badge>
                    ) : null}
                  </>
                }
              />
            </div>
          </header>

          <div className="mt-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
