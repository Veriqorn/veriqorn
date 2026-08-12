import {
  apiKeySchema,
  assignProjectMemberRequestSchema,
  createApiKeyRequestSchema,
  createProjectRequestSchema,
  meProfileSchema,
  projectRoleSchema,
  updateProjectRequestSchema,
} from '@veriqorn/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRoute, Link } from '@tanstack/react-router'
import {
  Bell,
  Bot,
  Check,
  Download,
  FileUp,
  FolderKanban,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  Shield,
  Trash2,
  Upload,
  Users,
} from 'lucide-react'
import { type ComponentType, useEffect, useMemo, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { QueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { isApiError, isRecord, unwrapApiData } from '@/lib/api'
import type { ApiClient } from '@/lib/api'
import { getAiLicenseConfigQueryOptions, getCapabilitiesQueryOptions, queryKeys } from '@/lib/queries'
import { useRuntime } from '@/providers/runtime-provider'
import { useAuth } from '@/providers/auth-provider'
import { useSettings } from '@/providers/settings-provider'
import { authedRoute } from '@/routes/authed'
import { validateSettingsSearch, type SettingsSection } from '@/router/search'
import type { ProjectSummary, UserProjectAccess } from '@/types'

import { settingsSections } from '@/config/settings-navigation'
import { isFrontendContributionEntitled, loadFrontendExtensions, settingsContributions, type LoadedFrontendExtension } from '@/extensions/registry'


type SectionState = 'live' | 'pending'

type RerunProfile = {
  id: string
  name: string
  framework: 'junit' | 'playwright' | 'testng'
  commandTemplate: string
  enabled: boolean
  ciTriggerUrl?: string
}

type RerunSettings = {
  activeProfileId?: string
  profiles?: RerunProfile[]
}

type SectionConfig = {
  description: string
  icon: typeof SettingsIcon
  note: string
  state: SectionState
  title: string
}

type ApiKeyRecord = {
  createdAt: string
  expiresAt: null | string
  id: number
  key?: string
  keyPrefix: string
  lastUsedAt: null | string
  name: string
}

type ProjectUserAccessRecord = UserProjectAccess

const sectionConfig: Record<SettingsSection, SectionConfig> = {
  'ai-analysis': {
    description: 'Configure the AI connection and evidence sources used for analysis.',
    icon: Bot,
    note: '',
    state: 'live',
    title: 'AI Analysis',
  },
  'api-keys': {
    description: 'Create and manage API keys for programmatic access.',
    icon: KeyRound,
    note: '',
    state: 'live',
    title: 'API Keys',
  },
  'auto-indexing': {
    description: 'Configure repository indexing, knowledge-base generation, and coverage evidence.',
    icon: RefreshCw,
    note: '',
    state: 'live',
    title: 'Auto-Indexing',
  },
  general: {
    description: 'Your account overview and current workspace settings.',
    icon: SettingsIcon,
    note: '',
    state: 'live',
    title: 'General',
  },
  notifications: {
    description: 'Configure project notification rules for Slack, webhook, and email delivery.',
    icon: Bot,
    note: '',
    state: 'live',
    title: 'Notifications',
  },
  projects: {
    description: 'Create, update, archive, and remove projects.',
    icon: FolderKanban,
    note: '',
    state: 'live',
    title: 'Projects',
  },
  rerun: {
    description: 'Configure test rerun execution profiles for Playwright, JUnit, and TestNG.',
    icon: RefreshCw,
    note: 'Rerun configuration is stored per-project and applied when triggering reruns from launch detail.',
    state: 'live',
    title: 'Test Rerun',
  },
  users: {
    description: 'Manage project members and access permissions.',
    icon: Users,
    note: '',
    state: 'live',
    title: 'User Management',
  },
  updates: {
    description: 'Review and safely apply published platform releases.',
    icon: Upload,
    note: 'Only platform administrators can request an update. The server-side update agent performs the deployment.',
    state: 'live',
    title: 'Platform Updates',
  },
}

const memberRoleOptions = projectRoleSchema.options
const RERUN_SETTINGS_KEY = 'testRerunProfiles'

export const settingsRoute = createRoute({
  component: SettingsPage,
  getParentRoute: () => authedRoute,
  path: 'settings',
  validateSearch: validateSettingsSearch,
})

function SettingsPage() {
  const queryClient = useQueryClient()
  const { apiClient } = useRuntime()
  const { user } = useAuth()
  const { activeProjectId, projects, refreshProjects, setActiveProjectId } = useSettings()
  const search = settingsRoute.useSearch()
  const [frontendExtensions, setFrontendExtensions] = useState<LoadedFrontendExtension[]>([])

  useEffect(() => {
    let active = true
    loadFrontendExtensions().then((extensions) => { if (active) setFrontendExtensions(extensions) }).catch(() => { if (active) setFrontendExtensions([]) })
    return () => { active = false }
  }, [])

  useQuery({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>('/api/v1/me')
      return meProfileSchema.parse(unwrapApiData(payload))
    },
    queryKey: ['settings', 'me'],
  })

  const apiKeysQuery = useQuery({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>('/api/v1/me/api-keys')
      const source = unwrapApiData(payload)

      if (!Array.isArray(source)) {
        return [] as ApiKeyRecord[]
      }

      return source.map((item) => apiKeySchema.extend({ key: apiKeySchema.shape.keyPrefix.optional() }).parse(item))
    },
    queryKey: ['settings', 'api-keys'],
  })

  // Notifications
  const notificationRulesQuery = useQuery({
    enabled: search.section === 'notifications',
    queryFn: async () => {
      try {
        const payload = await apiClient.get<unknown>(`/api/v1/projects/${encodeURIComponent(activeProjectId)}/notification-rules`)
        const data = unwrapApiData(payload)
        return isRecord(data) ? data : {}
      } catch { return {} }
    },
    queryKey: ['settings', 'notification-rules', activeProjectId],
  })

  // AI capabilities
  const aiCapabilitiesQuery = useQuery(getCapabilitiesQueryOptions(apiClient))

  const aiLicenseConfigQuery = useQuery(getAiLicenseConfigQueryOptions(apiClient))

  // Rerun settings
  const rerunSettingsQuery = useQuery({
    enabled: search.section === 'rerun',
    queryFn: async () => {
      try {
        const payload = await apiClient.get<unknown>(`/api/v1/settings/${RERUN_SETTINGS_KEY}?projectId=${encodeURIComponent(activeProjectId)}`)
        const data = unwrapApiData(payload)
        return isRecord(data) ? data.value : null
      } catch { return null }
    },
    queryKey: ['settings', 'rerun-settings', activeProjectId],
  })

  const [createApiKeyOpen, setCreateApiKeyOpen] = useState(false)
  const [createApiKeyName, setCreateApiKeyName] = useState('')
  const [createApiKeyExpiresAt, setCreateApiKeyExpiresAt] = useState('')
  const [createdApiKey, setCreatedApiKey] = useState<null | string>(null)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)

  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDescription, setNewProjectDescription] = useState('')
  const [projectMessage, setProjectMessage] = useState<null | { tone: 'error' | 'success'; value: string }>(null)
  const [editingProjectId, setEditingProjectId] = useState<null | string>(null)
  const [editingProjectName, setEditingProjectName] = useState('')
  const [editingProjectDescription, setEditingProjectDescription] = useState('')

  const createApiKeyMutation = useMutation({
    mutationFn: async () => {
      const body = createApiKeyRequestSchema.parse({
        expiresAt: createApiKeyExpiresAt.trim() || undefined,
        name: createApiKeyName.trim(),
      })
      const payload = await apiClient.post<unknown>('/api/v1/me/api-keys', body)
      const source = unwrapApiData(payload)
      const record = isRecord(source) ? source : {}
      return {
        ...apiKeySchema.parse(record),
        key: typeof record.key === 'string' ? record.key : '',
      }
    },
    onError: (error) => {
      setApiKeyError(resolveErrorMessage(error, 'Failed to create API key.'))
    },
    onSuccess: async (result) => {
      setCreatedApiKey(result.key)
      setApiKeyError(null)
      setCreateApiKeyName('')
      setCreateApiKeyExpiresAt('')
      await queryClient.invalidateQueries({ queryKey: ['settings', 'api-keys'] })
    },
  })

  const deleteApiKeyMutation = useMutation({
    mutationFn: async (apiKeyId: number) => {
      await apiClient.delete(`/api/v1/me/api-keys/${apiKeyId}`)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings', 'api-keys'] })
    },
  })

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      const body = createProjectRequestSchema.parse({
        description: newProjectDescription.trim() || undefined,
        name: newProjectName.trim(),
      })
      await apiClient.post('/api/v1/projects', body)
    },
    onError: (error) => {
      setProjectMessage({ tone: 'error', value: resolveErrorMessage(error, 'Failed to create project.') })
    },
    onSuccess: async () => {
      setProjectMessage({ tone: 'success', value: 'Project created.' })
      setNewProjectName('')
      setNewProjectDescription('')
      await refreshProjects()
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    },
  })

  const updateProjectMutation = useMutation({
    mutationFn: async () => {
      if (!editingProjectId) {
        return
      }

      const body = updateProjectRequestSchema.parse({
        description: editingProjectDescription.trim() || undefined,
        name: editingProjectName.trim(),
      })
      await apiClient.request(`/api/v1/projects/${encodeURIComponent(editingProjectId)}`, {
        body: JSON.stringify(body),
        method: 'PATCH',
      })
    },
    onError: (error) => {
      setProjectMessage({ tone: 'error', value: resolveErrorMessage(error, 'Failed to update project.') })
    },
    onSuccess: async () => {
      setProjectMessage({ tone: 'success', value: 'Project updated.' })
      setEditingProjectId(null)
      setEditingProjectName('')
      setEditingProjectDescription('')
      await refreshProjects()
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    },
  })

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await apiClient.delete(`/api/v1/projects/${encodeURIComponent(projectId)}?hardDelete=true`)
    },
    onError: (error) => {
      setProjectMessage({ tone: 'error', value: resolveErrorMessage(error, 'Failed to delete project.') })
    },
    onSuccess: async () => {
      setProjectMessage({ tone: 'success', value: 'Project deleted.' })
      setEditingProjectId(null)
      setEditingProjectName('')
      setEditingProjectDescription('')
      await refreshProjects()
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
    },
  })

  const sectionMeta = sectionConfig[search.section]
  const hasStoredProConfig = aiLicenseConfigQuery.data?.mode === 'pro_self_hosted' && aiLicenseConfigQuery.data?.hasStoredLicense === true
  const isProLicensed = Boolean(aiCapabilitiesQuery.data?.licensed) || hasStoredProConfig
  const extensionSettings = settingsContributions(frontendExtensions)
    .filter((contribution) => isFrontendContributionEntitled(contribution.requiredEntitlement, isProLicensed))
  const selectedExtensionSettings = extensionSettings.filter((contribution) => contribution.section === search.section)

  return (
    <section className="grid gap-6 xl:grid-cols-[0.3fr_0.7fr]" data-testid="settings-shell">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{sectionMeta.title}</CardTitle>
            <CardDescription>{sectionMeta.description}</CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sections</CardTitle>
            <CardDescription>All settings live under one typed `/settings?section=*` route.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {settingsSections.map((section) => {
              const Icon = sectionConfig[section.id].icon
              const isActive = search.section === section.id

              return (
                <Link
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                    isActive
                      ? 'border-[rgb(var(--app-accent))] bg-[rgb(var(--app-accent))]/10 text-[rgb(var(--app-ink))]'
                      : 'border-[rgb(var(--app-line))] bg-white/80 text-muted-foreground hover:border-[rgb(var(--app-accent))]/50 hover:text-[rgb(var(--app-ink))]'
                  }`}
                  data-testid={section.id === 'users' ? 'settings-nav-admin' : undefined}
                  key={section.id}
                  search={{ section: section.id }}
                  to="/settings"
                >
                  <Icon className="h-4 w-4" />
                  {section.label}
                </Link>
              )
            })}
            {extensionSettings.map((contribution) => {
              const section = contribution.section as SettingsSection | undefined
              if (!section) return null
              const Icon = sectionConfig[section].icon
              const isActive = search.section === section

              return (
                <Link
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                    isActive
                      ? 'border-[rgb(var(--app-accent))] bg-[rgb(var(--app-accent))]/10 text-[rgb(var(--app-ink))]'
                      : 'border-[rgb(var(--app-line))] bg-white/80 text-muted-foreground hover:border-[rgb(var(--app-accent))]/50 hover:text-[rgb(var(--app-ink))]'
                  }`}
                  key={contribution.id}
                  search={{ section }}
                  to="/settings"
                >
                  <Icon className="h-4 w-4" />
                  {contribution.title}
                </Link>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
  
        {search.section === 'general' ? (
          <GeneralSection
            aiCapabilities={aiCapabilitiesQuery.data}
            aiLicenseConfig={aiLicenseConfigQuery.data}
            apiClient={apiClient}
            queryClient={queryClient}
          />
        ) : null}

        {search.section === 'api-keys' ? (
          <ApiKeysSection
            apiKeysQuery={apiKeysQuery}
            apiKeyError={apiKeyError}
            createApiKeyExpiresAt={createApiKeyExpiresAt}
            createApiKeyMutation={createApiKeyMutation}
            createApiKeyName={createApiKeyName}
            createApiKeyOpen={createApiKeyOpen}
            createdApiKey={createdApiKey}
            deleteApiKeyMutation={deleteApiKeyMutation}
            onCreateApiKeyOpenChange={(open) => {
              setCreateApiKeyOpen(open)
              if (!open) {
                setCreatedApiKey(null)
                setApiKeyError(null)
              }
            }}
            setCreateApiKeyExpiresAt={setCreateApiKeyExpiresAt}
            setCreateApiKeyName={setCreateApiKeyName}
          />
        ) : null}

        {search.section === 'projects' ? (
          <ProjectsSection
            createProjectMutation={createProjectMutation}
            currentProjectId={activeProjectId}
            deleteProjectMutation={deleteProjectMutation}
            editingProjectDescription={editingProjectDescription}
            editingProjectId={editingProjectId}
            editingProjectName={editingProjectName}
            newProjectDescription={newProjectDescription}
            newProjectName={newProjectName}
            onSelectProject={setActiveProjectId}
            projectMessage={projectMessage}
            projects={projects}
            setEditingProjectDescription={setEditingProjectDescription}
            setEditingProjectId={setEditingProjectId}
            setEditingProjectName={setEditingProjectName}
            setNewProjectDescription={setNewProjectDescription}
            setNewProjectName={setNewProjectName}
            updateProjectMutation={updateProjectMutation}
          />
        ) : null}

        {search.section === 'users' ? (
          <UsersSection
            apiClient={apiClient}
            queryClient={queryClient}
          />
        ) : null}

        {search.section === 'notifications' ? (
          <NotificationsSection
            activeProjectId={activeProjectId}
            apiClient={apiClient}
            queryClient={queryClient}
            rulesQuery={notificationRulesQuery}
          />
        ) : null}

        {search.section === 'rerun' ? (
          <RerunSection
            activeProjectId={activeProjectId}
            apiClient={apiClient}
            queryClient={queryClient}
            rerunSettings={rerunSettingsQuery.data}
          />
        ) : null}

        {search.section === 'updates' ? (
          <PlatformUpdatesSection apiClient={apiClient} isAdmin={user?.role === 'admin'} />
        ) : null}

        {selectedExtensionSettings.map((contribution) => {
          const Component = contribution.component as ComponentType
          return <Component key={contribution.id} />
        })}
      </div>
    </section>
  )
}

type PlatformUpdateStatus = {
  configured: boolean
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseNotesUrl: string | null
  job: null | {
    id: string
    status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'
    message?: string
    requestedAt?: string
  }
}

function PlatformUpdatesSection({ apiClient, isAdmin }: { apiClient: ApiClient; isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [feedback, setFeedback] = useState<null | { tone: 'error' | 'success'; value: string }>(null)
  const statusQuery = useQuery({
    enabled: isAdmin,
    queryFn: async () => {
      const payload = await apiClient.get<unknown>('/api/v1/platform-update/status')
      return unwrapApiData(payload) as PlatformUpdateStatus
    },
    queryKey: ['platform-update', 'status'],
    refetchInterval: 15_000,
  })
  const updateMutation = useMutation({
    mutationFn: () => apiClient.post<unknown>('/api/v1/platform-update/jobs'),
    onError: (error) => setFeedback({ tone: 'error', value: resolveErrorMessage(error, 'Failed to request the update.') }),
    onSuccess: async () => {
      setFeedback({ tone: 'success', value: 'Update requested. The page may briefly reconnect while services restart.' })
      await queryClient.invalidateQueries({ queryKey: ['platform-update', 'status'] })
    },
  })

  if (!isAdmin) {
    return <Alert><AlertTitle>Administrator access required</AlertTitle><AlertDescription>Only platform administrators can view or request platform updates.</AlertDescription></Alert>
  }

  const status = statusQuery.data
  const updateRunning = status?.job?.status === 'queued' || status?.job?.status === 'running'
  return (
    <Card data-testid="settings-platform-updates">
      <CardHeader>
        <CardTitle className="text-base">Platform updates</CardTitle>
        <CardDescription>Updates are executed by a separate server-side agent. The platform itself never receives Docker access.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQuery.isLoading ? <p className="text-sm text-muted-foreground">Checking installed versionâ€¦</p> : null}
        {statusQuery.isError ? <Alert variant="destructive"><AlertTitle>Update status is unavailable</AlertTitle><AlertDescription>{resolveErrorMessage(statusQuery.error, 'Could not contact the update service.')}</AlertDescription></Alert> : null}
        {status ? <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">Installed</p><p className="font-medium">{status.currentVersion}</p></div>
            <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">Available</p><p className="font-medium">{status.latestVersion ?? 'No published release detected'}</p></div>
          </div>
          {!status.configured ? <Alert><AlertTitle>Updates are not configured</AlertTitle><AlertDescription>Set PLATFORM_UPDATE_AGENT_URL and PLATFORM_UPDATE_AGENT_TOKEN in the installation environment, then deploy the isolated update agent.</AlertDescription></Alert> : null}
          {status.job ? <Alert><AlertTitle>Last update: {status.job.status}</AlertTitle><AlertDescription>{status.job.message ?? `Job ${status.job.id}`}</AlertDescription></Alert> : null}
          {feedback ? <Alert variant={feedback.tone === 'error' ? 'destructive' : 'default'}><AlertDescription>{feedback.value}</AlertDescription></Alert> : null}
          <div className="flex flex-wrap gap-3">
            <Button disabled={!status.configured || !status.updateAvailable || updateRunning || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
              {updateMutation.isPending || updateRunning ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {updateRunning ? 'Update in progress' : 'Install update'}
            </Button>
            {status.releaseNotesUrl ? <Button asChild variant="outline"><a href={status.releaseNotesUrl} rel="noreferrer" target="_blank">Release notes</a></Button> : null}
          </div>
        </> : null}
      </CardContent>
    </Card>
  )
}

function GeneralSection({
  aiCapabilities,
  aiLicenseConfig,
  apiClient,
  queryClient,
}: {
  aiCapabilities: unknown
  aiLicenseConfig: unknown
  apiClient: ApiClient
  queryClient: QueryClient
}) {
  return (
    <div className="space-y-6">
      <PlanCard
        aiCapabilities={aiCapabilities}
        aiLicenseConfig={aiLicenseConfig}
        apiClient={apiClient}
        queryClient={queryClient}
      />
      <BrandingCard apiClient={apiClient} queryClient={queryClient} />
    </div>
  )
}

function BrandingCard({ apiClient, queryClient }: { apiClient: ApiClient; queryClient: QueryClient }) {
  const logoQuery = useQuery({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>('/api/v1/settings/branding/logo')
      const data = unwrapApiData(payload)
      return isRecord(data) && typeof data.value === 'string' ? data.value : null
    },
    queryKey: ['settings', 'branding', 'logo'],
  })

  const [dataUrl, setDataUrl] = useState<null | string>(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<null | { tone: 'error' | 'success'; value: string }>(null)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 512 * 1024) {
      setFeedback({ tone: 'error', value: 'Logo must be under 512 KB.' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setDataUrl(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => setFeedback({ tone: 'error', value: 'Failed to read file.' })
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!dataUrl) return
    setSaving(true)
    setFeedback(null)
    try {
      await apiClient.put<unknown>('/api/v1/settings/branding/logo', { value: dataUrl })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'branding', 'logo'] })
      setDataUrl(null)
      setFeedback({ tone: 'success', value: 'Logo updated.' })
    } catch (error) {
      setFeedback({ tone: 'error', value: resolveErrorMessage(error, 'Failed to save logo.') })
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      await apiClient.put<unknown>('/api/v1/settings/branding/logo', { value: '' })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'branding', 'logo'] })
      setDataUrl(null)
      setFeedback({ tone: 'success', value: 'Logo cleared.' })
    } catch (error) {
      setFeedback({ tone: 'error', value: resolveErrorMessage(error, 'Failed to clear logo.') })
    } finally {
      setSaving(false)
    }
  }

  const current = logoQuery.data
  const preview = dataUrl ?? current

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Brand logo</CardTitle>
        <CardDescription>This image is shown in the sidebar and top bar. PNG or SVG, under 512 KB.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-border bg-secondary/40">
            {preview ? (
              <img alt="Logo preview" className="max-h-full max-w-full object-contain" src={preview} />
            ) : (
              <span className="text-xs text-muted-foreground">No logo</span>
            )}
          </div>
          <div className="space-y-2">
            <Input accept="image/png,image/svg+xml,image/jpeg" onChange={handleFileChange} type="file" />
            <p className="text-xs text-muted-foreground">Recommended: square PNG or SVG with transparent background.</p>
          </div>
        </div>

        {feedback ? (
          <Alert variant={feedback.tone === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>{feedback.value}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button disabled={saving || !current} onClick={clear} variant="outline">
            Clear logo
          </Button>
          <Button disabled={saving || !dataUrl} onClick={save}>
            {saving ? 'Savingâ€¦' : 'Save logo'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function PlanCard({
  aiCapabilities,
  aiLicenseConfig,
  apiClient,
  queryClient,
}: {
  aiCapabilities: unknown
  aiLicenseConfig: unknown
  apiClient: ApiClient
  queryClient: QueryClient
}) {
  const caps = isRecord(aiCapabilities) ? aiCapabilities : {}
  const config = isRecord(aiLicenseConfig) ? aiLicenseConfig : {}
  const hasStoredProConfig =
    config.mode === 'pro_self_hosted' && config.hasStoredLicense === true
  const licensed = Boolean(caps.licensed) || hasStoredProConfig
  const capabilityLicense = isRecord(caps.license) ? (caps.license as Record<string, unknown>) : null
  const storedLicense = isRecord(config.license) ? (config.license as Record<string, unknown>) : null
  const license = capabilityLicense ?? storedLicense
  const status = typeof caps.status === 'string' ? caps.status : licensed ? 'licensed' : 'stub'
  const licenseId = license && typeof license.licenseId === 'string' ? license.licenseId : null
  const customer = license && typeof license.customer === 'string' ? license.customer : null
  const expiresAtRaw = license ? license.expiresAt : null
  const expiresAt = typeof expiresAtRaw === 'string' ? expiresAtRaw : null

  const [activateOpen, setActivateOpen] = useState(false)
  const [licenseJson, setLicenseJson] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [exportingRequest, setExportingRequest] = useState(false)
  const [feedback, setFeedback] = useState<null | { tone: 'error' | 'success'; value: string }>(null)

  const downloadActivationRequest = async () => {
    setExportingRequest(true)
    setFeedback(null)
    try {
      const response = await apiClient.get<unknown>('/api/v1/ai/license-activation-request')
      const request = unwrapApiData(response)
      if (!isRecord(request)) throw new Error('The activation request response is invalid.')
      const blob = new Blob([`${JSON.stringify(request, null, 2)}\n`], { type: 'application/json' })
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.download = 'veriqorn-activation-request.json'
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(href), 0)
      setFeedback({ tone: 'success', value: 'Activation request downloaded. Send this file to Veriqorn to receive a license.' })
    } catch (error) {
      setFeedback({ tone: 'error', value: resolveErrorMessage(error, 'Failed to download the activation request.') })
    } finally {
      setExportingRequest(false)
    }
  }

  const loadLicenseFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setLicenseJson(await file.text())
      setFeedback(null)
    } catch {
      setFeedback({ tone: 'error', value: 'Unable to read the selected license file.' })
    }
  }

  const submit = async () => {
    if (!licenseJson.trim()) {
      setFeedback({ tone: 'error', value: 'Paste the license JSON before activating.' })
      return
    }
    setSubmitting(true)
    setFeedback(null)
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(licenseJson)
      } catch {
        throw new Error('Invalid JSON â€” paste the license payload exactly as issued.')
      }
      await apiClient.post<unknown>('/api/v1/ai/license-activations', parsed)
      await queryClient.invalidateQueries({ queryKey: ['settings', 'ai-capabilities'] })
      await queryClient.invalidateQueries({ queryKey: ['ai-analysis', 'license-config'] })
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiCapabilities() })
      setActivateOpen(false)
      setLicenseJson('')
      setFeedback({ tone: 'success', value: 'License activated. AI Pro features are now enabled.' })
    } catch (error) {
      setFeedback({ tone: 'error', value: resolveErrorMessage(error, 'Failed to activate license.') })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4 text-primary" />
          Plan &amp; license
        </CardTitle>
        <CardDescription>Your current Veriqorn plan and AI license status.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={licensed ? 'default' : 'outline'}>
            {licensed ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Enterprise
              </>
            ) : (
              'Community'
            )}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {licensed
              ? expiresAt
                ? `License active, expires ${formatDate(expiresAt)}.`
                : 'License active.'
              : 'Running on Community. Activate an Enterprise license to enable Enterprise features.'}
          </span>
          {status !== 'stub' && status !== 'licensed' ? (
            <Badge variant="outline">status: {status}</Badge>
          ) : null}
        </div>

        {license ? (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">License ID</p>
              <p className="mt-2 text-sm font-medium">{licenseId ?? 'Present'}</p>
            </div>
            <div className="rounded-2xl border bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Customer</p>
              <p className="mt-2 text-sm font-medium">{customer ?? 'Self-hosted deployment'}</p>
            </div>
            <div className="rounded-2xl border bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Expires</p>
              <p className="mt-2 text-sm font-medium">
                {expiresAt ? formatDate(expiresAt) : 'No expiry in payload'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            License details will appear here after activation.
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button disabled={exportingRequest} onClick={() => void downloadActivationRequest()} variant="outline">
            {exportingRequest ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download activation request
          </Button>
          <Dialog
            onOpenChange={(open) => {
              setActivateOpen(open)
              if (!open) {
                setLicenseJson('')
              }
            }}
            open={activateOpen}
          >
            <Button onClick={() => setActivateOpen(true)} variant={licensed ? 'outline' : 'default'}>
              {licensed ? 'Replace license' : 'Activate license'}
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{licensed ? 'Replace license' : 'Activate license'}</DialogTitle>
                <DialogDescription>
                  Upload the license JSON issued by Veriqorn, or paste its contents below. The payload is verified
                  against the platform public key and this installation before Pro features are enabled.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="license-file">Issued license file</Label>
                <Input
                  accept="application/json,.json"
                  id="license-file"
                  onChange={(event) => {
                    void loadLicenseFile(event.target.files?.[0])
                    event.target.value = ''
                  }}
                  type="file"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="license-json">License JSON</Label>
                <Textarea
                  id="license-json"
                  onChange={(event) => setLicenseJson(event.target.value)}
                  placeholder='{"licenseId":"...","signature":"..."}'
                  rows={8}
                  value={licenseJson}
                />
              </div>

              <DialogFooter>
                <Button disabled={submitting} onClick={submit}>
                  {submitting ? 'Activatingâ€¦' : <><FileUp className="mr-2 h-4 w-4" />{licensed ? 'Replace license' : 'Activate license'}</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {feedback ? (
          <Alert variant={feedback.tone === 'error' ? 'destructive' : 'default'}>
            <AlertTitle>{feedback.tone === 'error' ? 'Activation failed' : 'License activated'}</AlertTitle>
            <AlertDescription>{feedback.value}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ApiKeysSection({
  apiKeysQuery,
  apiKeyError,
  createApiKeyExpiresAt,
  createApiKeyMutation,
  createApiKeyName,
  createApiKeyOpen,
  createdApiKey,
  deleteApiKeyMutation,
  onCreateApiKeyOpenChange,
  setCreateApiKeyExpiresAt,
  setCreateApiKeyName,
}: {
  apiKeysQuery: ReturnType<typeof useQuery<ApiKeyRecord[]>>
  apiKeyError: null | string
  createApiKeyExpiresAt: string
  createApiKeyMutation: ReturnType<typeof useMutation<ApiKeyRecord, unknown, void, unknown>>
  createApiKeyName: string
  createApiKeyOpen: boolean
  createdApiKey: null | string
  deleteApiKeyMutation: ReturnType<typeof useMutation<void, unknown, number, unknown>>
  onCreateApiKeyOpenChange: (open: boolean) => void
  setCreateApiKeyExpiresAt: (value: string) => void
  setCreateApiKeyName: (value: string) => void
}) {
  const apiKeys = apiKeysQuery.data ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" />
              API keys
            </CardTitle>
            <CardDescription>API keys for programmatic access to your account.</CardDescription>
          </div>
          <Button onClick={() => onCreateApiKeyOpenChange(true)}>
            <Plus className="h-4 w-4" />
            Create API key
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {apiKeysQuery.isLoading ? (
          <LoadingState message="Loading API keys..." />
        ) : apiKeys.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((apiKey) => (
                <TableRow key={apiKey.id}>
                  <TableCell className="font-medium text-foreground">{apiKey.name}</TableCell>
                  <TableCell>
                    <code className="rounded bg-[rgb(var(--app-shell))] px-2 py-1 text-xs text-white/90">
                      {apiKey.keyPrefix}...
                    </code>
                  </TableCell>
                  <TableCell>{formatDate(apiKey.createdAt)}</TableCell>
                  <TableCell>{apiKey.lastUsedAt ? formatDate(apiKey.lastUsedAt) : 'Never'}</TableCell>
                  <TableCell>{apiKey.expiresAt ? formatDate(apiKey.expiresAt) : 'Never'}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      disabled={deleteApiKeyMutation.isPending}
                      onClick={() => deleteApiKeyMutation.mutate(apiKey.id)}
                      size="sm"
                      variant="outline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState message="No API keys have been created yet." />
        )}
      </CardContent>

      <Dialog onOpenChange={onCreateApiKeyOpenChange} open={createApiKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              New keys are shown exactly once after creation. Store the generated value before closing this dialog.
            </DialogDescription>
          </DialogHeader>

          {createdApiKey ? (
            <div className="space-y-4">
              <Alert variant="warning">
                <AlertTitle>Copy this key now</AlertTitle>
                <AlertDescription>The plain token will not be visible again after this dialog closes.</AlertDescription>
              </Alert>
              <div className="rounded-2xl bg-[rgb(var(--app-shell))] px-4 py-4 text-sm text-white/90 break-all">
                {createdApiKey}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="api-key-name">Name</Label>
                <Input
                  id="api-key-name"
                  onChange={(event) => setCreateApiKeyName(event.target.value)}
                  placeholder="CI pipeline"
                  value={createApiKeyName}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api-key-expires">Expires at (optional)</Label>
                <Input
                  id="api-key-expires"
                  onChange={(event) => setCreateApiKeyExpiresAt(event.target.value)}
                  type="datetime-local"
                  value={createApiKeyExpiresAt}
                />
              </div>
              {apiKeyError ? (
                <Alert variant="destructive">
                  <AlertTitle>Creation failed</AlertTitle>
                  <AlertDescription>{apiKeyError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => onCreateApiKeyOpenChange(false)} variant="outline">
              {createdApiKey ? 'Close' : 'Cancel'}
            </Button>
            {!createdApiKey ? (
              <Button disabled={createApiKeyMutation.isPending} onClick={() => createApiKeyMutation.mutate()}>
                {createApiKeyMutation.isPending ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create key'
                )}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function ProjectsSection({
  createProjectMutation,
  currentProjectId,
  deleteProjectMutation,
  editingProjectDescription,
  editingProjectId,
  editingProjectName,
  newProjectDescription,
  newProjectName,
  onSelectProject,
  projectMessage,
  projects,
  setEditingProjectDescription,
  setEditingProjectId,
  setEditingProjectName,
  setNewProjectDescription,
  setNewProjectName,
  updateProjectMutation,
}: {
  createProjectMutation: ReturnType<typeof useMutation<void, unknown, void, unknown>>
  currentProjectId: string
  deleteProjectMutation: ReturnType<typeof useMutation<void, unknown, string, unknown>>
  editingProjectDescription: string
  editingProjectId: null | string
  editingProjectName: string
  newProjectDescription: string
  newProjectName: string
  onSelectProject: (projectId: string) => void
  projectMessage: null | { tone: 'error' | 'success'; value: string }
  projects: ProjectSummary[]
  setEditingProjectDescription: (value: string) => void
  setEditingProjectId: (value: null | string) => void
  setEditingProjectName: (value: string) => void
  setNewProjectDescription: (value: string) => void
  setNewProjectName: (value: string) => void
  updateProjectMutation: ReturnType<typeof useMutation<void, unknown, void, unknown>>
}) {
  const activeProjects = projects.filter((project) => !project.isArchived)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FolderKanban className="h-4 w-4 text-primary" />
            Project scope
          </CardTitle>
          <CardDescription>Choose which project the shell and project-scoped settings panels act on.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="settings-project-scope">Active project</Label>
          <Select onValueChange={onSelectProject} value={currentProjectId}>
            <SelectTrigger id="settings-project-scope" className="max-w-md">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {activeProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                  {project.isDefault ? ' (default)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create project</CardTitle>
          <CardDescription>Create a new project to organise your test launches.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-project-name">Name</Label>
              <Input
                id="new-project-name"
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="QA Platform"
                value={newProjectName}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-project-description">Description</Label>
              <Input
                id="new-project-description"
                onChange={(event) => setNewProjectDescription(event.target.value)}
                placeholder="Optional description"
                value={newProjectDescription}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled={createProjectMutation.isPending} onClick={() => createProjectMutation.mutate()}>
              {createProjectMutation.isPending ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create project'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {projectMessage ? (
        <Alert variant={projectMessage.tone === 'error' ? 'destructive' : 'success'}>
          <AlertTitle>{projectMessage.tone === 'error' ? 'Project action failed' : 'Project action complete'}</AlertTitle>
          <AlertDescription>{projectMessage.value}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project inventory</CardTitle>
          <CardDescription>Edit project name, description, and lifecycle status.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => {
                const isEditing = editingProjectId === project.id

                return (
                  <TableRow key={project.id}>
                    <TableCell>
                      {isEditing ? (
                        <Input onChange={(event) => setEditingProjectName(event.target.value)} value={editingProjectName} />
                      ) : (
                        <div>
                          <p className="font-medium text-foreground">{project.name}</p>
                          <p className="text-xs text-muted-foreground">{project.id}</p>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{project.key}</TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Textarea onChange={(event) => setEditingProjectDescription(event.target.value)} value={editingProjectDescription} />
                      ) : (
                        project.description || 'No description'
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={project.isArchived ? 'warning' : 'success'}>
                          {project.isArchived ? 'archived' : 'active'}
                        </Badge>
                        {project.isDefault ? <Badge variant="outline">default</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {isEditing ? (
                          <>
                            <Button disabled={updateProjectMutation.isPending} onClick={() => updateProjectMutation.mutate()} size="sm">
                              Save
                            </Button>
                            <Button
                              onClick={() => {
                                setEditingProjectId(null)
                                setEditingProjectName('')
                                setEditingProjectDescription('')
                              }}
                              size="sm"
                              variant="outline"
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            {!project.isArchived ? (
                              <Button
                                onClick={() => {
                                  setEditingProjectId(project.id)
                                  setEditingProjectName(project.name)
                                  setEditingProjectDescription(project.description ?? '')
                                }}
                                size="sm"
                                variant="outline"
                              >
                                Edit
                              </Button>
                            ) : null}
                            {!project.isDefault ? (
                              <Button
                                disabled={deleteProjectMutation.isPending}
                                onClick={() => deleteProjectMutation.mutate(project.id)}
                                size="sm"
                                variant="outline"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </Button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

interface GlobalUserRecord {
  id: number
  name: string
  email: string
  role: string
}

function UsersSection({
  apiClient,
  queryClient,
}: {
  apiClient: ApiClient
  queryClient: QueryClient
}) {
  return (
    <div className="space-y-6" data-testid="settings-admin-panel">
      <PlatformUsersCard apiClient={apiClient} queryClient={queryClient} />
    </div>
  )
}

const USER_ROLES = ['admin', 'user'] as const
type UserRole = (typeof USER_ROLES)[number]

function PlatformUsersCard({ apiClient, queryClient }: { apiClient: ApiClient; queryClient: QueryClient }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<GlobalUserRecord | null>(null)
  const [feedback, setFeedback] = useState<null | { tone: 'error' | 'success'; value: string }>(null)

  const usersQuery = useQuery({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>('/api/v1/users')
      const data = unwrapApiData(payload)
      return Array.isArray(data) ? (data as GlobalUserRecord[]) : []
    },
    queryKey: ['settings', 'platform-users'],
  })

  const deleteUserMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete<unknown>(`/api/v1/users/${id}`)
    },
    onError: (error) => setFeedback({ tone: 'error', value: resolveErrorMessage(error, 'Failed to remove user.') }),
    onSuccess: async () => {
      setFeedback({ tone: 'success', value: 'User removed.' })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'platform-users'] })
    },
  })

  const users = usersQuery.data ?? []

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-primary" />
                Platform users
              </CardTitle>
              <CardDescription>All accounts able to sign in. Edit a user to change their role or reset password.</CardDescription>
            </div>
            <Button onClick={() => { setFeedback(null); setCreateOpen(true) }}>
              <Plus className="h-4 w-4" />
              Create user
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {feedback ? (
            <Alert className="mb-4" variant={feedback.tone === 'error' ? 'destructive' : 'default'}>
              <AlertDescription>{feedback.value}</AlertDescription>
            </Alert>
          ) : null}
          {usersQuery.isLoading ? (
            <LoadingState message="Loading usersâ€¦" />
          ) : users.length === 0 ? (
            <EmptyState message="No users yet. Create the first account to get started." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium text-foreground">{user.name || 'â€”'}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === 'admin' ? 'default' : 'outline'}>{user.role}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          onClick={() => { setFeedback(null); setEditing(user) }}
                          size="sm"
                          variant="outline"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          disabled={deleteUserMutation.isPending}
                          onClick={() => {
                            if (confirm(`Remove user ${user.email}?`)) deleteUserMutation.mutate(user.id)
                          }}
                          size="sm"
                          variant="outline"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateUserDialog
        apiClient={apiClient}
        onClose={() => setCreateOpen(false)}
        onFeedback={setFeedback}
        onSuccess={async () => {
          setCreateOpen(false)
          await queryClient.invalidateQueries({ queryKey: ['settings', 'platform-users'] })
        }}
        open={createOpen}
      />

      <EditUserDialog
        apiClient={apiClient}
        onClose={() => setEditing(null)}
        onFeedback={setFeedback}
        onSuccess={async () => {
          setEditing(null)
          await queryClient.invalidateQueries({ queryKey: ['settings', 'platform-users'] })
        }}
        queryClient={queryClient}
        user={editing}
      />
    </>
  )
}

function CreateUserDialog({
  apiClient,
  onClose,
  onFeedback,
  onSuccess,
  open,
}: {
  apiClient: ApiClient
  onClose: () => void
  onFeedback: (value: { tone: 'error' | 'success'; value: string }) => void
  onSuccess: () => Promise<void>
  open: boolean
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setEmail('')
      setPassword('')
      setRole('user')
    }
  }, [open])

  const submit = async () => {
    if (!email.trim() || !password) return
    setSubmitting(true)
    try {
      await apiClient.post<unknown>('/api/v1/users', {
        name: name.trim() || email.trim(),
        email: email.trim(),
        password,
        role,
      })
      onFeedback({ tone: 'success', value: `User ${email.trim()} created.` })
      await onSuccess()
    } catch (error) {
      onFeedback({ tone: 'error', value: resolveErrorMessage(error, 'Failed to create user.') })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={(next) => { if (!next) onClose() }} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>Add a new account to the platform.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="create-user-email">Email</Label>
            <Input id="create-user-email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-user-name">Display name</Label>
            <Input id="create-user-name" onChange={(event) => setName(event.target.value)} placeholder="Optional; defaults to email" value={name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-user-password">Temporary password</Label>
            <Input id="create-user-password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-user-role">Role</Label>
            <Select onValueChange={(value) => setRole(value as UserRole)} value={role}>
              <SelectTrigger id="create-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose} variant="outline">Cancel</Button>
          <Button disabled={submitting || !email.trim() || !password} onClick={submit}>
            {submitting ? 'Creatingâ€¦' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditUserDialog({
  apiClient,
  onClose,
  onFeedback,
  onSuccess,
  queryClient,
  user,
}: {
  apiClient: ApiClient
  onClose: () => void
  onFeedback: (value: { tone: 'error' | 'success'; value: string }) => void
  onSuccess: () => Promise<void>
  queryClient: QueryClient
  user: GlobalUserRecord | null
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('user')
  const [projectRole, setProjectRole] = useState<(typeof memberRoleOptions)[number]>('viewer')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [projectAccessMessage, setProjectAccessMessage] = useState<null | { tone: 'error' | 'success'; value: string }>(null)
  const [projectAccessBusy, setProjectAccessBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const { projects } = useSettings()

  const userAccessQuery = useQuery({
    enabled: user !== null,
    queryFn: async () => {
      const payload = await apiClient.get<unknown>('/api/v1/projects/access/users')
      return normalizeUserAccessList(unwrapApiData(payload))
    },
    queryKey: ['settings', 'user-access'],
  })

  useEffect(() => {
    if (user) {
      setName(user.name ?? '')
      setEmail(user.email ?? '')
      setPassword('')
      setRole((USER_ROLES as readonly string[]).includes(user.role) ? (user.role as UserRole) : 'user')
      setProjectRole('viewer')
      setSelectedProjectId('')
      setProjectAccessMessage(null)
    }
  }, [user])

  if (!user) return null

  const currentAccess = userAccessQuery.data?.find((entry) => entry.userId === user.id) ?? null
  const memberships = currentAccess?.memberships ?? []
  const activeProjects = projects.filter((project) => !project.isArchived)
  const assignableProjects = activeProjects.filter((project) => !memberships.some((membership) => membership.projectId === project.id))

  const addProjectAccess = async () => {
    if (!selectedProjectId) {
      return
    }

    setProjectAccessBusy(true)
    setProjectAccessMessage(null)
    try {
      const body = assignProjectMemberRequestSchema.parse({
        projectRole,
        userId: String(user.id),
      })
      await apiClient.post(`/api/v1/projects/${encodeURIComponent(selectedProjectId)}/members`, body)
      setProjectAccessMessage({ tone: 'success', value: 'Project access added.' })
      setSelectedProjectId('')
      setProjectRole('viewer')
      await queryClient.invalidateQueries({ queryKey: ['settings', 'user-access'] })
    } catch (error) {
      setProjectAccessMessage({ tone: 'error', value: resolveErrorMessage(error, 'Failed to add project access.') })
    } finally {
      setProjectAccessBusy(false)
    }
  }

  const removeProjectAccess = async (projectId: string) => {
    setProjectAccessBusy(true)
    setProjectAccessMessage(null)
    try {
      await apiClient.delete(`/api/v1/projects/${encodeURIComponent(projectId)}/members/${user.id}`)
      setProjectAccessMessage({ tone: 'success', value: 'Project access removed.' })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'user-access'] })
    } catch (error) {
      setProjectAccessMessage({ tone: 'error', value: resolveErrorMessage(error, 'Failed to remove project access.') })
    } finally {
      setProjectAccessBusy(false)
    }
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        role,
      }
      if (password) body.password = password
      await apiClient.put<unknown>(`/api/v1/users/${user.id}`, body)
      onFeedback({ tone: 'success', value: 'User updated.' })
      await onSuccess()
    } catch (error) {
      onFeedback({ tone: 'error', value: resolveErrorMessage(error, 'Failed to update user.') })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={(next) => { if (!next) onClose() }} open={user !== null}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>Update profile details, role, and project access.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-user-email">Email</Label>
            <Input id="edit-user-email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-user-name">Display name</Label>
            <Input id="edit-user-name" onChange={(event) => setName(event.target.value)} value={name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-user-password">New password</Label>
            <Input id="edit-user-password" onChange={(event) => setPassword(event.target.value)} placeholder="Leave blank to keep existing" type="password" value={password} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-user-role">Role</Label>
            <Select onValueChange={(value) => setRole(value as UserRole)} value={role}>
              <SelectTrigger id="edit-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USER_ROLES.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4 rounded-2xl border border-[rgb(var(--app-line))] p-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Project access</h3>
              <p className="text-sm text-muted-foreground">Manage which projects this user can access.</p>
            </div>

            {projectAccessMessage ? (
              <Alert variant={projectAccessMessage.tone === 'error' ? 'destructive' : 'success'}>
                <AlertTitle>{projectAccessMessage.tone === 'error' ? 'Access update failed' : 'Access updated'}</AlertTitle>
                <AlertDescription>{projectAccessMessage.value}</AlertDescription>
              </Alert>
            ) : null}

            {userAccessQuery.isLoading ? (
              <LoadingState message="Loading project access..." />
            ) : memberships.length > 0 ? (
              <div className="space-y-2">
                {memberships.map((membership) => (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgb(var(--app-line))] px-4 py-3" key={membership.projectId}>
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">{membership.projectName}</div>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <Badge variant="outline">{membership.projectRole}</Badge>
                        {membership.isArchived ? <Badge variant="secondary">Archived</Badge> : null}
                      </div>
                    </div>
                    <Button
                      disabled={projectAccessBusy}
                      onClick={() => removeProjectAccess(membership.projectId)}
                      size="sm"
                      variant="outline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="This user does not have explicit access to any project yet." />
            )}

            <div className="grid gap-4 md:grid-cols-[1fr_180px_auto]">
              <div className="space-y-2">
                <Label htmlFor="edit-user-project">Project</Label>
                <Select onValueChange={setSelectedProjectId} value={selectedProjectId}>
                  <SelectTrigger id="edit-user-project">
                    <SelectValue placeholder={assignableProjects.length > 0 ? 'Choose a project' : 'No available projects'} />
                  </SelectTrigger>
                  <SelectContent>
                    {assignableProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-user-project-role">Role</Label>
                <Select onValueChange={(value) => setProjectRole(value as (typeof memberRoleOptions)[number])} value={projectRole}>
                  <SelectTrigger id="edit-user-project-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {memberRoleOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button disabled={projectAccessBusy || !selectedProjectId} onClick={addProjectAccess}>
                  {projectAccessBusy ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Add access'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose} variant="outline">Cancel</Button>
          <Button disabled={submitting} onClick={submit}>
            {submitting ? 'Savingâ€¦' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[rgb(var(--app-line))] px-4 py-8 text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function LoadingState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[rgb(var(--app-line))] px-4 py-4 text-sm text-muted-foreground">
      <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
      {message}
    </div>
  )
}

function normalizeUserAccessList(value: unknown): ProjectUserAccessRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }

    const userId = Number(entry.userId)
    if (!Number.isFinite(userId)) {
      return []
    }

    const memberships = Array.isArray(entry.memberships)
      ? entry.memberships.flatMap((membership) => {
          if (!isRecord(membership)) {
            return []
          }

          return [
            {
              isArchived: Boolean(membership.isArchived),
              projectId: String(membership.projectId ?? ''),
              projectName: String(membership.projectName ?? 'Unknown project'),
              projectRole: projectRoleSchema.parse(membership.projectRole ?? 'viewer'),
            },
          ]
        })
      : []

    return [
      {
        memberships,
        platformRole: entry.platformRole === 'admin' ? 'admin' : 'user',
        userEmail: String(entry.userEmail ?? ''),
        userId,
        userName: String(entry.userName ?? 'Unknown user'),
      },
    ]
  })
}

function resolveErrorMessage(error: unknown, fallback: string) {
  return isApiError(error) ? error.message : fallback
}

function formatDate(value: string) {
  if (!value) return 'Unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

// â”€â”€â”€ Notifications Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type NotifRules = {
  enabled?: boolean
  deliveryDelaySeconds?: number
  deliveryMode?: 'per-test' | 'summary'
  events?: string[]
  destinations?: Array<{
    enabled?: boolean
    id?: string
    name?: string
    type: 'email' | 'slack' | 'telegram' | 'webhook' | string
    channel?: string
    url?: string
    webhookUrl?: string
  }>
  sendCompletionNotice?: boolean
}

type NotificationDestinationDraft = {
  channel: string
  enabled: boolean
  id: string
  name: string
  type: 'email' | 'slack' | 'telegram' | 'webhook'
  webhookUrl: string
}

type NotificationHistoryRecord = {
  attempt: number
  createdAt: string
  deliveredAt?: null | string
  destinationId: string
  destinationType: string
  errorMessage?: null | string
  event: string
  id: string
  responseCode?: null | number
  runId?: null | number
  status: string
  triggeredBy?: string
}

type NotificationTestDeliveryResponse = {
  failed: number
  results?: Array<{ destinationId: string; error?: string; status: 'failed' | 'sent' | 'skipped' }>
  sent: number
  skipped: number
}

const notificationDestinationTypeOptions: Array<NotificationDestinationDraft['type']> = ['webhook', 'slack', 'telegram', 'email']

const notificationDestinationTypeLabels: Record<NotificationDestinationDraft['type'], string> = {
  email: 'Email',
  slack: 'Slack',
  telegram: 'Telegram',
  webhook: 'Webhook',
}

const notificationDestinationTypeCopy: Record<NotificationDestinationDraft['type'], {
  channelLabel: string
  channelPlaceholder: string
  description: string
  urlLabel: string
  urlPlaceholder: string
}> = {
  email: {
    channelLabel: 'Recipient email',
    channelPlaceholder: 'alerts@example.com',
    description: 'Sends notification content to an email recipient.',
    urlLabel: 'Delivery endpoint',
    urlPlaceholder: 'smtp://mail.example.com or provider endpoint',
  },
  slack: {
    channelLabel: 'Slack channel',
    channelPlaceholder: '#alerts',
    description: 'Sends notification content to a Slack incoming webhook target.',
    urlLabel: 'Incoming webhook URL',
    urlPlaceholder: 'https://hooks.slack.com/services/...',
  },
  telegram: {
    channelLabel: 'Telegram chat ID',
    channelPlaceholder: '123456789',
    description: 'Sends notification content to a Telegram bot or webhook target.',
    urlLabel: 'Bot / webhook URL',
    urlPlaceholder: 'https://api.telegram.org/bot... or webhook endpoint',
  },
  webhook: {
    channelLabel: 'Optional channel / tag',
    channelPlaceholder: 'release-alerts',
    description: 'Sends notification content to a generic HTTP webhook endpoint.',
    urlLabel: 'Webhook URL',
    urlPlaceholder: 'https://your-server.com/webhook',
  },
}

const notificationDeliveryModeLabels: Record<NonNullable<NotifRules['deliveryMode']>, string> = {
  'per-test': 'Each test separately',
  summary: 'Single summary message',
}

const buildNotificationSummaryChartDataUrl = (stats: { broken: number; failed: number; passed: number; skipped: number; total: number }) => {
  const segments = [
    { value: Math.max(0, stats.passed), color: '#16a34a' },
    { value: Math.max(0, stats.failed), color: '#dc2626' },
    { value: Math.max(0, stats.broken), color: '#f59e0b' },
    { value: Math.max(0, stats.skipped), color: '#6b7280' },
  ].filter((segment) => segment.value > 0)
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || Math.max(1, stats.total)
  const radius = 84
  const circumference = 2 * Math.PI * radius
  let offset = 0

  const arcs = segments.map((segment) => {
    const length = (segment.value / total) * circumference
    const arc = `<circle cx="120" cy="120" r="${radius}" fill="none" stroke="${segment.color}" stroke-linecap="round" stroke-width="26" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 120 120)" />`
    offset += length
    return arc
  }).join('')

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" role="img" aria-label="Test run donut chart">
      <rect width="100%" height="100%" rx="24" fill="#ffffff" />
      <circle cx="120" cy="120" r="${radius}" fill="none" stroke="#e5e7eb" stroke-width="26" />
      ${arcs}
      <circle cx="120" cy="120" r="42" fill="#ffffff" />
      <text x="120" y="116" text-anchor="middle" font-size="26" font-weight="700" fill="#111827">${stats.total}</text>
      <text x="120" y="138" text-anchor="middle" font-size="12" fill="#6b7280">tests</text>
      <text x="24" y="214" font-size="11" fill="#374151">Passed ${stats.passed} Â· Failed ${stats.failed} Â· Broken ${stats.broken} Â· Skipped ${stats.skipped}</text>
    </svg>
  `.trim()

  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}

const createNotificationDestinationDraft = (
  type: NotificationDestinationDraft['type'] = 'webhook',
  index = 0,
): NotificationDestinationDraft => ({
  channel: '',
  enabled: true,
  id: `${type}-${Date.now()}-${index + 1}`,
  name: `${notificationDestinationTypeLabels[type]} ${index + 1}`,
  type,
  webhookUrl: '',
})

const normalizeNotificationDestinations = (value: unknown): NotificationDestinationDraft[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry, index) => {
      const type = entry.type === 'slack' || entry.type === 'telegram' || entry.type === 'email' || entry.type === 'webhook'
        ? entry.type
        : 'webhook'

      return {
        channel: typeof entry.channel === 'string' ? entry.channel : '',
        enabled: entry.enabled !== false,
        id: typeof entry.id === 'string' && entry.id ? entry.id : `${type}-${index + 1}`,
        name: typeof entry.name === 'string' && entry.name ? entry.name : `${notificationDestinationTypeLabels[type]} ${index + 1}`,
        type,
        webhookUrl: typeof entry.webhookUrl === 'string'
          ? entry.webhookUrl
          : typeof entry.url === 'string'
            ? entry.url
            : '',
      }
    })
}

const buildNotificationDestinations = (destinations: NotificationDestinationDraft[]) =>
  destinations.map((destination) => ({
    channel: destination.channel.trim(),
    enabled: destination.enabled,
    id: destination.id.trim(),
    name: destination.name.trim(),
    type: destination.type,
    ...(destination.webhookUrl.trim() ? { webhookUrl: destination.webhookUrl.trim() } : {}),
  }))

function NotificationsSection({
  activeProjectId,
  apiClient,
  queryClient,
  rulesQuery,
}: {
  activeProjectId: string
  apiClient: ApiClient
  queryClient: QueryClient
  rulesQuery: UseQueryResult<Record<string, unknown>>
}) {
  const rawRules = rulesQuery.data ?? {}
  const parsed: NotifRules = {
    deliveryDelaySeconds: typeof rawRules.deliveryDelaySeconds === 'number' ? rawRules.deliveryDelaySeconds : 0,
    deliveryMode: rawRules.deliveryMode === 'per-test' ? 'per-test' : 'summary',
    enabled: rawRules.enabled !== false,
    events: Array.isArray(rawRules.events) ? rawRules.events as string[] : ['run-completion'],
    destinations: Array.isArray(rawRules.destinations) ? rawRules.destinations as NotifRules['destinations'] : [],
    sendCompletionNotice: rawRules.sendCompletionNotice !== false,
  }

  const [enabled, setEnabled] = useState(parsed.enabled ?? true)
  const [deliveryMode, setDeliveryMode] = useState<NonNullable<NotifRules['deliveryMode']>>(parsed.deliveryMode ?? 'summary')
  const [deliveryDelaySeconds, setDeliveryDelaySeconds] = useState(parsed.deliveryDelaySeconds ?? 0)
  const [sendCompletionNotice, setSendCompletionNotice] = useState(parsed.sendCompletionNotice ?? true)
  const [events, setEvents] = useState<string[]>(parsed.events ?? ['run-completion'])
  const [destinations, setDestinations] = useState<NotificationDestinationDraft[]>(
    normalizeNotificationDestinations(parsed.destinations),
  )
  const [saving, setSaving] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [testDestinationId, setTestDestinationId] = useState('all')
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; value: string } | null>(null)

  const historyQuery = useQuery({
    enabled: Boolean(activeProjectId),
    queryFn: async () => {
      const payload = await apiClient.get<unknown>(`/api/v1/projects/${encodeURIComponent(activeProjectId)}/notification-deliveries?limit=20`)
      const data = unwrapApiData(payload)
      return Array.isArray(data) ? data as NotificationHistoryRecord[] : []
    },
    queryKey: ['settings', 'notification-history', activeProjectId],
  })

  const persistedDestinations = useMemo(
    () => normalizeNotificationDestinations(rawRules.destinations),
    [rawRules.destinations],
  )

  useEffect(() => {
    if (!rulesQuery.data) return

    const r = rulesQuery.data
    setEnabled(r.enabled !== false)
    setDeliveryMode(r.deliveryMode === 'per-test' ? 'per-test' : 'summary')
    setDeliveryDelaySeconds(typeof r.deliveryDelaySeconds === 'number' ? r.deliveryDelaySeconds : 0)
    setSendCompletionNotice(r.sendCompletionNotice !== false)
    setEvents(Array.isArray(r.events) ? (r.events as string[]) : ['run-completion'])
    setDestinations(normalizeNotificationDestinations(r.destinations))
  }, [rulesQuery.data])

  useEffect(() => {
    if (testDestinationId === 'all') return
    if (!persistedDestinations.some((destination) => destination.id === testDestinationId)) {
      setTestDestinationId('all')
    }
  }, [persistedDestinations, testDestinationId])

  const toggleEvent = (ev: string) => {
    setEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev])
  }

  const preview = useMemo(() => {
    const primaryType = destinations[0]?.type ?? 'webhook'
    const typeLabel = notificationDestinationTypeLabels[primaryType]
    const lines: string[] = []
    const chartDataUrl = buildNotificationSummaryChartDataUrl({
      broken: 0,
      failed: 2,
      passed: 42,
      skipped: 0,
      total: 44,
    })

    lines.push(`Destination type: ${typeLabel}`)
    lines.push(`Delivery mode: ${notificationDeliveryModeLabels[deliveryMode]}`)

    if (deliveryMode === 'summary') {
      lines.push('')
      lines.push('Test run completed: Checkout smoke')
      lines.push('Status: completed')
      lines.push('Passed: 42/44')
      lines.push('Failed: 2')
      lines.push('Broken: 0')
      lines.push('Skipped: 0')
    } else {
      lines.push('')
      lines.push('Test 1/3: login.spec.ts::should_sign_in')
      lines.push('Run: Checkout smoke')
      lines.push('Result: passed')
      lines.push('')
      lines.push('Test 2/3: checkout.spec.ts::should_pay')
      lines.push('Run: Checkout smoke')
      lines.push('Result: failed')
      lines.push('')
      lines.push('Test 3/3: cart.spec.ts::should_restore_cart')
      lines.push('Run: Checkout smoke')
      lines.push('Result: passed')
      if (sendCompletionNotice) {
        lines.push('')
        lines.push(`Final notice: Sent 3 test notifications after ${deliveryDelaySeconds || 0}s delay between messages.`)
      }
    }

    if (deliveryMode === 'per-test' && !sendCompletionNotice) {
      lines.push('')
      lines.push('No completion notice will be sent after the test series.')
    }

    return {
      chartDataUrl: deliveryMode === 'summary' ? chartDataUrl : null,
      title: deliveryMode === 'summary' ? 'Single message preview' : 'Per-test series preview',
      lines,
    }
  }, [deliveryDelaySeconds, deliveryMode, destinations, sendCompletionNotice])

  const addDestination = (type: NotificationDestinationDraft['type'] = 'webhook') => {
    setDestinations((prev) => [...prev, createNotificationDestinationDraft(type, prev.length)])
  }

  const updateDestination = (id: string, patch: Partial<NotificationDestinationDraft>) => {
    setDestinations((prev) => prev.map((destination) => (destination.id === id ? { ...destination, ...patch } : destination)))
  }

  const removeDestination = (id: string) => {
    setDestinations((prev) => prev.filter((destination) => destination.id !== id))
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    const savedDestinations = buildNotificationDestinations(destinations)
    try {
      await apiClient.put<unknown>(`/api/v1/projects/${encodeURIComponent(activeProjectId)}/notification-rules`, {
        destinations: savedDestinations,
        deliveryDelaySeconds: Math.max(0, Math.floor(deliveryDelaySeconds)),
        deliveryMode,
        enabled,
        events,
        sendCompletionNotice,
      })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'notification-rules', activeProjectId] })
      setMessage({ tone: 'success', value: 'Notification rules saved.' })
    } catch (err) {
      setMessage({ tone: 'error', value: isApiError(err) ? err.message : 'Failed to save.' })
    } finally {
      setSaving(false)
    }
  }

  const eventLabels: Record<string, string> = {
    'run-broken': 'Run has broken tests',
    'run-completion': 'Run completed',
    'run-failed': 'Run failed',
  }

  const sendTestNotification = async () => {
    if (persistedDestinations.length === 0) {
      setMessage({ tone: 'error', value: 'Save at least one destination before sending a test notification.' })
      return
    }

    setSendingTest(true)
    setMessage(null)
    try {
      const payload = await apiClient.post<unknown>(
        `/api/v1/projects/${encodeURIComponent(activeProjectId)}/notification-rules/test-delivery`,
        testDestinationId === 'all' ? {} : { destinationId: testDestinationId },
      )
      const data = unwrapApiData(payload) as NotificationTestDeliveryResponse
      await queryClient.invalidateQueries({ queryKey: ['settings', 'notification-history', activeProjectId] })
      setMessage({
        tone: data.failed > 0 ? 'error' : 'success',
        value: `Test delivery finished: sent ${data.sent}, failed ${data.failed}, skipped ${data.skipped}.`,
      })
    } catch (err) {
      setMessage({ tone: 'error', value: isApiError(err) ? err.message : 'Failed to send test notification.' })
    } finally {
      setSendingTest(false)
    }
  }

  const history = historyQuery.data ?? []

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4" />Notification rules</CardTitle>
          <CardDescription>Configure when and where to send notifications for this project.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {rulesQuery.isLoading ? <LoadingState message="Loading rules..." /> : null}

          <div className="flex items-center gap-3">
            <input checked={enabled} className="h-4 w-4 accent-primary" id="notif-enabled" onChange={(e) => setEnabled(e.target.checked)} type="checkbox" />
            <Label htmlFor="notif-enabled">Enable notifications for this project</Label>
          </div>

          <div className="space-y-2">
            <Label>Trigger events</Label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(eventLabels).map(([ev, label]) => (
                <button
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${events.includes(ev) ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
                  key={ev}
                  onClick={() => toggleEvent(ev)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl border border-border bg-secondary/30 p-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Delivery mode</Label>
              <Select onValueChange={(value) => setDeliveryMode(value as NonNullable<NotifRules['deliveryMode']>)} value={deliveryMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(notificationDeliveryModeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose whether the run is sent as one summary or as a sequence of individual test messages.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notification-delay">Delay between messages, seconds</Label>
              <Input
                id="notification-delay"
                min={0}
                onChange={(event) => setDeliveryDelaySeconds(Number(event.target.value) || 0)}
                type="number"
                value={deliveryDelaySeconds}
              />
              <p className="text-xs text-muted-foreground">
                Helps avoid rate limits when sending multiple test messages.
              </p>
            </div>

            {deliveryMode === 'per-test' ? (
              <div className="flex items-center gap-3 md:col-span-2">
                <input
                  checked={sendCompletionNotice}
                  className="h-4 w-4 accent-primary"
                  id="notification-completion-notice"
                  onChange={(event) => setSendCompletionNotice(event.target.checked)}
                  type="checkbox"
                />
                <Label htmlFor="notification-completion-notice">Send a completion notice after the test series</Label>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <Label>Destinations</Label>
            <div className="space-y-3">
              {destinations.length === 0 ? (
                <Alert>
                  <AlertDescription>No destinations yet. Add Slack, Telegram, Email, or Webhook targets below.</AlertDescription>
                </Alert>
              ) : null}

              <div className="space-y-3">
                {destinations.map((destination) => (
                  <div className="rounded-2xl border border-border bg-secondary/40 p-4" data-testid="notification-destination-card" key={destination.id}>
                    <p className="mb-4 text-xs text-muted-foreground">
                      {notificationDestinationTypeCopy[destination.type].description}
                    </p>
                    <div className="grid gap-4 lg:grid-cols-[1fr_180px_1fr]">
                      <div className="space-y-1.5">
                        <Label>Name</Label>
                        <Input
                          onChange={(event) => updateDestination(destination.id, { name: event.target.value })}
                          value={destination.name}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Type</Label>
                        <Select
                          onValueChange={(value) => updateDestination(destination.id, { type: value as NotificationDestinationDraft['type'] })}
                          value={destination.type}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {notificationDestinationTypeOptions.map((type) => (
                              <SelectItem key={type} value={type}>
                                {notificationDestinationTypeLabels[type]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Choose the delivery system for this recipient. The URL and channel labels update automatically.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label>{notificationDestinationTypeCopy[destination.type].urlLabel}</Label>
                        <Input
                          onChange={(event) => updateDestination(destination.id, { webhookUrl: event.target.value })}
                          placeholder={notificationDestinationTypeCopy[destination.type].urlPlaceholder}
                          value={destination.webhookUrl}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{notificationDestinationTypeCopy[destination.type].channelLabel}</Label>
                        <Input
                          onChange={(event) => updateDestination(destination.id, { channel: event.target.value })}
                          placeholder={notificationDestinationTypeCopy[destination.type].channelPlaceholder}
                          value={destination.channel}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Recipient ID</Label>
                        <Input
                          onChange={(event) => updateDestination(destination.id, { id: event.target.value })}
                          placeholder="stable-recipient-id"
                          value={destination.id}
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          checked={destination.enabled}
                          className="h-4 w-4 accent-primary"
                          onChange={(event) => updateDestination(destination.id, { enabled: event.target.checked })}
                          type="checkbox"
                        />
                        Enabled
                      </label>
                      <Button onClick={() => removeDestination(destination.id)} size="sm" type="button" variant="outline">
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button data-testid="notification-add-destination" onClick={() => addDestination('webhook')} type="button" variant="outline">
                  <Plus className="h-4 w-4" />
                  Add recipient
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label>Preview</Label>
            <div className="rounded-2xl border border-border bg-background p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">{preview.title}</p>
                <Badge variant="outline">{destinations[0] ? notificationDestinationTypeLabels[destinations[0].type] : 'Webhook'}</Badge>
              </div>
              {preview.chartDataUrl ? (
                <div className="mb-4 flex flex-wrap items-center gap-4">
                  <img alt="Notification preview chart" className="h-32 w-32 rounded-xl border border-border bg-white p-2" src={preview.chartDataUrl} />
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Run donut chart</p>
                    <p>This image is included in summary messages so the overall run status is visible at a glance.</p>
                  </div>
                </div>
              ) : null}
              <pre className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{preview.lines.join('\n')}</pre>
            </div>
          </div>

          {message && (
            <Alert variant={message.tone === 'success' ? 'default' : 'destructive'}>
              <AlertDescription>{message.value}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <Button className="gap-2" disabled={saving} onClick={save}>
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save notification rules
            </Button>

            <div className="min-w-[220px] space-y-1.5">
              <Label htmlFor="notification-test-target">Test target</Label>
              <select
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-ring"
                id="notification-test-target"
                onChange={(event) => setTestDestinationId(event.target.value)}
                value={testDestinationId}
              >
                <option value="all">All saved destinations</option>
                {persistedDestinations
                  .filter((destination) => destination.id)
                  .map((destination) => (
                    <option key={destination.id} value={destination.id}>
                      {destination.name || destination.id} ({notificationDestinationTypeLabels[destination.type] ?? destination.type})
                    </option>
                  ))}
              </select>
            </div>

            <Button className="gap-2" disabled={sendingTest} onClick={sendTestNotification} variant="outline">
              {sendingTest ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              Send test notification
            </Button>

            <Button className="gap-2" onClick={() => void historyQuery.refetch()} variant="outline">
              <RefreshCw className="h-4 w-4" />
              Refresh history
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery history</CardTitle>
          <CardDescription>Recent notification delivery attempts for this project.</CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <LoadingState message="Loading notification history..." />
          ) : history.length === 0 ? (
            <EmptyState message="No notification delivery attempts yet." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{formatDate(entry.createdAt)}</TableCell>
                    <TableCell>{entry.destinationType} / {entry.destinationId}</TableCell>
                    <TableCell>{entry.event}</TableCell>
                    <TableCell>
                      <Badge variant={entry.status === 'sent' ? 'default' : 'outline'}>{entry.status}</Badge>
                    </TableCell>
                    <TableCell>{entry.attempt}</TableCell>
                    <TableCell>{entry.errorMessage || 'â€”'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// â”€â”€â”€ AI Analysis Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function RerunSection({
  activeProjectId,
  apiClient,
  queryClient,
  rerunSettings,
}: {
  activeProjectId: string
  apiClient: ApiClient
  queryClient: QueryClient
  rerunSettings: unknown
}) {
  const parsed: RerunSettings = isRecord(rerunSettings) ? rerunSettings as RerunSettings : { profiles: [] }
  const [profiles, setProfiles] = useState<RerunProfile[]>(parsed.profiles ?? [])
  const [activeProfileId, setActiveProfileId] = useState(parsed.activeProfileId ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; value: string } | null>(null)

  useEffect(() => {
    if (isRecord(rerunSettings)) {
      const s = rerunSettings as RerunSettings
      setProfiles(s.profiles ?? [])
      setActiveProfileId(s.activeProfileId ?? '')
    }
  }, [rerunSettings])

  const addProfile = () => {
    const id = `profile-${Date.now()}`
    setProfiles((prev) => [...prev, { commandTemplate: '', enabled: true, framework: 'playwright', id, name: 'New Profile' }])
  }

  const updateProfile = (id: string, patch: Partial<RerunProfile>) => {
    setProfiles((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p))
  }

  const removeProfile = (id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id))
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await apiClient.put<unknown>(`/api/v1/settings/${RERUN_SETTINGS_KEY}?projectId=${encodeURIComponent(activeProjectId)}`, {
        value: { activeProfileId, profiles },
      })
      await queryClient.invalidateQueries({ queryKey: ['settings', 'rerun-settings', activeProjectId] })
      setMessage({ tone: 'success', value: 'Rerun settings saved.' })
    } catch (err) {
      setMessage({ tone: 'error', value: isApiError(err) ? err.message : 'Failed to save.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><RefreshCw className="h-4 w-4" />Test rerun profiles</CardTitle>
          <CardDescription>Configure how failed tests are re-executed for this project.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {profiles.length === 0 ? (
            <EmptyState message="No rerun profiles configured. Add a profile to enable test reruns." />
          ) : (
            <div className="space-y-4">
              {profiles.map((profile) => (
                <div className="rounded-2xl border border-border bg-secondary/50 p-4 space-y-3" key={profile.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <input
                        checked={activeProfileId === profile.id}
                        className="h-4 w-4 accent-primary"
                        name="active-profile"
                        onChange={() => setActiveProfileId(profile.id)}
                        type="radio"
                      />
                      <span className="text-xs font-semibold text-muted-foreground">Active</span>
                    </div>
                    <Button onClick={() => removeProfile(profile.id)} size="sm" variant="ghost">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Profile name</Label>
                      <Input onChange={(e) => updateProfile(profile.id, { name: e.target.value })} value={profile.name} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Framework</Label>
                      <Select onValueChange={(v) => updateProfile(profile.id, { framework: v as RerunProfile['framework'] })} value={profile.framework}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="playwright">Playwright</SelectItem>
                          <SelectItem value="junit">JUnit</SelectItem>
                          <SelectItem value="testng">TestNG</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Command template</Label>
                      <Input
                        onChange={(e) => updateProfile(profile.id, { commandTemplate: e.target.value })}
                        placeholder="npx playwright test --grep-invert '' {test_names}"
                        value={profile.commandTemplate}
                      />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>CI trigger URL (optional)</Label>
                      <Input
                        onChange={(e) => updateProfile(profile.id, { ciTriggerUrl: e.target.value })}
                        placeholder="https://ci.example.com/trigger"
                        value={profile.ciTriggerUrl ?? ''}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button className="gap-2" onClick={addProfile} variant="outline">
            <Plus className="h-4 w-4" /> Add profile
          </Button>

          {message && (
            <Alert variant={message.tone === 'success' ? 'default' : 'destructive'}>
              <AlertDescription>{message.value}</AlertDescription>
            </Alert>
          )}

          <Button className="gap-2" disabled={saving} onClick={save}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save rerun settings
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
