import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRoute } from '@tanstack/react-router'
import {
  FileArchive,
  Files,
  Filter,
  FolderOpen,
  FolderTree,
  Import,
  LoaderCircle,
  Plus,
  RefreshCcw,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isApiError } from '@/lib/api'
import { normalizeDateInputToSearchValue, searchValueToDateInput } from '@/lib/date-search'
import {
  completeProjectRun,
  createProjectRun,
  getProjectLaunchesQueryOptions,
  importProjectAllureResultsFromPath,
  importProjectAllureResultsFromUpload,
  invalidateProjectRunQueries,
} from '@/lib/queries'
import { PageActions } from '@/providers/page-actions-provider'
import { useRuntime } from '@/providers/runtime-provider'
import { projectLayoutRoute } from '@/routes/project-layout'
import { defaultLaunchesSearch, validateLaunchesSearch } from '@/router/search'

type ImportMode = 'ci_archive' | 'directory_path' | 'uploaded_files'
type DirectoryPickerEntry =
  | { getFile: () => Promise<File>; kind: 'file'; name: string }
  | { kind: 'directory'; name: string; values: () => AsyncIterable<DirectoryPickerEntry> }
type DirectoryPickerHandle = { values: () => AsyncIterable<DirectoryPickerEntry> }

export const projectLaunchesRoute = createRoute({
  component: ProjectLaunchesPage,
  getParentRoute: () => projectLayoutRoute,
  loader: async ({ context, deps, params }) => {
    const search = validateLaunchesSearch(deps)
    await context.queryClient.ensureQueryData(getProjectLaunchesQueryOptions(context.apiClient, params.projectId, search))
  },
  loaderDeps: ({ search }): ReturnType<typeof validateLaunchesSearch> => validateLaunchesSearch(search),
  path: 'launches',
  validateSearch: validateLaunchesSearch,
})

function ProjectLaunchesPage() {
  const navigate = projectLaunchesRoute.useNavigate()
  const queryClient = useQueryClient()
  const { apiClient } = useRuntime()
  const { projectId } = projectLaunchesRoute.useParams()
  const search = projectLaunchesRoute.useSearch()
  const launchesQuery = useQuery(getProjectLaunchesQueryOptions(apiClient, projectId, search))
  const [createRunOpen, setCreateRunOpen] = useState(false)
  const [newRunName, setNewRunName] = useState('')
  const [newRunBranch, setNewRunBranch] = useState('')
  const [newRunEnvironment, setNewRunEnvironment] = useState('')
  const [newRunTags, setNewRunTags] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importMode, setImportMode] = useState<ImportMode>('directory_path')
  const [importRunName, setImportRunName] = useState('')
  const [importBranch, setImportBranch] = useState('')
  const [importEnvironment, setImportEnvironment] = useState('')
  const [importTags, setImportTags] = useState('')
  const [importDirectoryPath, setImportDirectoryPath] = useState('')
  const [importTargetRunId, setImportTargetRunId] = useState('new')
  const [importFiles, setImportFiles] = useState<File[]>([])
  const [importArchiveFile, setImportArchiveFile] = useState<File | null>(null)
  const [pageMessage, setPageMessage] = useState<null | { tone: 'error' | 'success'; value: string }>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const directoryInputRef = useRef<HTMLInputElement | null>(null)

  const launches = useMemo(() => launchesQuery.data?.items ?? [], [launchesQuery.data?.items])
  const total = launchesQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / search.limit))

  const importTargetRun = importTargetRunId === 'new' ? null : launches.find((launch) => launch.id === importTargetRunId) ?? null

  const openLaunch = (launchId: string) => {
    void navigate({
      params: { launchId, projectId },
      search: { tab: 'overview' },
      to: '/projects/$projectId/launches/$launchId',
    })
  }

  const resetImportForm = () => {
    setImportMode('directory_path')
    setImportRunName('')
    setImportBranch('')
    setImportEnvironment('')
    setImportTags('')
    setImportDirectoryPath('')
    setImportTargetRunId('new')
    setImportFiles([])
    setImportArchiveFile(null)
  }

  const handleDirectoryImportSelection = async () => {
    const normalizePickedFiles = (files: File[]) => {
      const normalized = files.map((file) => {
        const relativePath = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, '/')
        return relativePath !== file.name
          ? new File([file], relativePath, { lastModified: file.lastModified, type: file.type })
          : file
      })

      setImportArchiveFile(null)
      setImportFiles(normalized)
      setImportMode('uploaded_files')
    }

    const pickerHost = window as Window & {
      showDirectoryPicker?: () => Promise<DirectoryPickerHandle>
    }

    if (typeof pickerHost.showDirectoryPicker === 'function') {
      try {
        const root = await pickerHost.showDirectoryPicker()
        const collected: File[] = []

        const visit = async (handle: DirectoryPickerHandle, prefix = '') => {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
              const file = await entry.getFile()
              collected.push(new File([file], `${prefix}${entry.name}`, { lastModified: file.lastModified, type: file.type }))
              continue
            }

            if (entry.kind === 'directory') {
              await visit(entry, `${prefix}${entry.name}/`)
            }
          }
        }

        await visit(root)
        if (collected.length === 0) {
          setPageMessage({ tone: 'error', value: 'No files were found in the selected directory.' })
          return
        }

        normalizePickedFiles(collected)
        setPageMessage({ tone: 'success', value: `Selected ${collected.length} files from a local directory.` })
        return
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
      }
    }

    directoryInputRef.current?.click()
  }

  const createRunMutation = useMutation({
    mutationFn: async () =>
      createProjectRun(apiClient, projectId, {
        branch: newRunBranch.trim() || undefined,
        environment: newRunEnvironment.trim() || undefined,
        name: newRunName.trim(),
        tags: parseTagInput(newRunTags),
      }),
    onError: (error) => {
      setPageMessage({
        tone: 'error',
        value: resolveErrorMessage(error, 'Failed to create launch.'),
      })
    },
    onSuccess: async (run) => {
      await invalidateProjectRunQueries(queryClient, projectId, run.id)
      setCreateRunOpen(false)
      setNewRunName('')
      setNewRunBranch('')
      setNewRunEnvironment('')
      setNewRunTags('')
      setPageMessage({ tone: 'success', value: `Launch "${run.name}" created.` })
      void navigate({
        params: { launchId: run.id, projectId },
        search: { tab: 'overview' },
        to: '/projects/$projectId/launches/$launchId',
      })
    },
  })

  const completeRunMutation = useMutation({
    mutationFn: async (launchId: string) => completeProjectRun(apiClient, projectId, launchId),
    onError: (error) => {
      setPageMessage({
        tone: 'error',
        value: resolveErrorMessage(error, 'Failed to complete launch.'),
      })
    },
    onSuccess: async (run) => {
      await invalidateProjectRunQueries(queryClient, projectId, run.id)
      setPageMessage({ tone: 'success', value: `Launch "${run.name}" marked as completed.` })
    },
  })

  const importResultsMutation = useMutation({
    mutationFn: async () => {
      const parentRunId = importTargetRunId === 'new' ? undefined : importTargetRunId
      const runName = importTargetRunId === 'new' ? importRunName.trim() : undefined

      if (!parentRunId && !runName) {
        throw new Error('Run name is required when importing into a new launch.')
      }

      if (importMode === 'directory_path') {
        const directoryPath = importDirectoryPath.trim()
        if (!directoryPath) {
          throw new Error('Directory path is required for path-based import.')
        }

        return importProjectAllureResultsFromPath(apiClient, projectId, {
          branch: importBranch.trim() || undefined,
          directoryPath,
          environment: importEnvironment.trim() || undefined,
          parentRunId,
          runName,
          tags: parseTagInput(importTags),
        })
      }

      if (importMode === 'uploaded_files') {
        if (importFiles.length === 0) {
          throw new Error('Select one or more Allure result files before importing.')
        }

        return importProjectAllureResultsFromUpload(apiClient, projectId, {
          branch: importBranch.trim() || undefined,
          environment: importEnvironment.trim() || undefined,
          files: importFiles,
          parentRunId,
          runName,
          sourceKind: importFiles.length === 1 ? 'uploaded_file' : 'uploaded_batch',
          tags: parseTagInput(importTags),
        })
      }

      if (!importArchiveFile) {
        throw new Error('Select a ZIP archive before importing.')
      }

      return importProjectAllureResultsFromUpload(apiClient, projectId, {
        branch: importBranch.trim() || undefined,
        environment: importEnvironment.trim() || undefined,
        files: [importArchiveFile],
        parentRunId,
        runName,
        sourceKind: 'ci_archive',
        tags: parseTagInput(importTags),
      })
    },
    onError: (error) => {
      setPageMessage({
        tone: 'error',
        value: resolveErrorMessage(error, 'Failed to import Allure results.'),
      })
    },
    onSuccess: async (result) => {
      await invalidateProjectRunQueries(queryClient, projectId, result.testRun.id)
      setImportOpen(false)
      resetImportForm()
      setPageMessage({ tone: 'success', value: result.message })
      void navigate({
        params: { launchId: result.testRun.id, projectId },
        search: { tab: 'overview' },
        to: '/projects/$projectId/launches/$launchId',
      })
    },
  })

  const applySearch = (nextSearch: typeof search) => {
    void navigate({
      params: { projectId },
      search: nextSearch,
      to: '/projects/$projectId/launches',
    })
  }

  const clearFilters = () => {
    void navigate({
      params: { projectId },
      search: defaultLaunchesSearch,
      to: '/projects/$projectId/launches',
    })
  }

  const filterPanelKey = [
    search.branch ?? '',
    search.dateFrom ?? '',
    search.dateTo ?? '',
    search.search ?? '',
    search.status ?? '',
  ].join('|')

  const goToPage = (page: number) => {
    void navigate({
      params: { projectId },
      search: {
        ...search,
        page,
      },
      to: '/projects/$projectId/launches',
    })
  }

  const activeFilterCount =
    (search.search ? 1 : 0) +
    (search.branch ? 1 : 0) +
    (search.status ? 1 : 0) +
    (search.dateFrom ? 1 : 0) +
    (search.dateTo ? 1 : 0)

  return (
    <div className="space-y-6">
      <PageActions>
        <Button onClick={() => setFiltersOpen(true)} size="sm" variant="outline">
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 ? (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
        <Button data-testid="launches-create-run-trigger" onClick={() => setCreateRunOpen(true)} size="sm">
          <Plus className="h-4 w-4" />
          Create launch
        </Button>
        <Button data-testid="launches-import-results-trigger" onClick={() => setImportOpen(true)} size="sm" variant="secondary">
          <Import className="h-4 w-4" />
          Import results
        </Button>
        <Button onClick={() => void launchesQuery.refetch()} size="sm" variant="outline">
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      </PageActions>

      {pageMessage ? (
        <Alert variant={pageMessage.tone === 'error' ? 'destructive' : 'success'}>
          <AlertTitle>{pageMessage.tone === 'error' ? 'Action failed' : 'Action complete'}</AlertTitle>
          <AlertDescription>{pageMessage.value}</AlertDescription>
        </Alert>
      ) : null}

      <LaunchFiltersDialog
        key={filterPanelKey}
        onApply={applySearch}
        onClear={clearFilters}
        onClose={() => setFiltersOpen(false)}
        open={filtersOpen}
        search={search}
      />

      <section className="rounded-[28px] border border-[rgb(var(--app-line))] bg-white/90 p-6 shadow-[0_20px_55px_rgba(22,29,42,0.07)]">
        <div className="flex flex-wrap items-center justify-end gap-4 text-sm text-[rgb(var(--app-muted))]">
          Page {search.page} of {totalPages}
        </div>

        {launchesQuery.isLoading ? (
          <div className="mt-6 rounded-3xl border border-dashed border-[rgb(var(--app-line))] px-4 py-8 text-sm text-[rgb(var(--app-muted))]">
            Loading launches...
          </div>
        ) : launchesQuery.error ? (
          <div className="mt-6 rounded-3xl border border-red-200 bg-red-50/80 px-4 py-4 text-sm leading-7 text-red-900">
            Failed to load launches. Please try refreshing the page.
          </div>
      ) : launches.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-dashed border-[rgb(var(--app-line))] px-4 py-8 text-sm text-[rgb(var(--app-muted))]">
            No launches match the current filters.
          </div>
        ) : (
          <div className="mt-6 overflow-hidden rounded-[28px] border border-[rgb(var(--app-line))]">
            <table className="min-w-full divide-y divide-[rgb(var(--app-line))] bg-white/90 text-sm" data-testid="launches-table">
              <thead className="bg-[rgb(var(--app-surface))]/90 text-left text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--app-muted))]">
                <tr>
                  <th className="px-4 py-3">Launch</th>
                  <th className="px-4 py-3">Scope</th>
                  <th className="px-4 py-3">Tests</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--app-line))]">
                {launches.map((launch) => (
                  <tr
                    className="cursor-pointer align-top transition hover:bg-[rgb(var(--app-surface))]/60"
                    key={launch.id}
                    onClick={() => openLaunch(launch.id)}
                  >
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[rgb(var(--app-ink))]">{launch.name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-[rgb(var(--app-muted))]">
                            <p className="text-base font-semibold">Run #{launch.id}</p>
                            <p className="text-xs">Started {formatDateTime(launch.startTime)}</p>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-xs leading-6 text-[rgb(var(--app-muted))]">
                      <div className="space-y-1">
                        <p>
                          <span className="font-medium uppercase tracking-[0.16em] text-[rgb(var(--app-ink))]">Branch:</span>{' '}
                          {launch.branch || 'No branch'}
                        </p>
                        <p>
                          <span className="font-medium uppercase tracking-[0.16em] text-[rgb(var(--app-ink))]">Tags:</span>{' '}
                          {launch.tags?.length ? launch.tags.join(', ') : 'No tags'}
                        </p>
                        <p>
                          <span className="font-medium uppercase tracking-[0.16em] text-[rgb(var(--app-ink))]">Environment:</span>{' '}
                          {launch.environment || 'No environment'}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <LaunchTestBar
                        onSegmentClick={(status) => {
                          void navigate({
                            params: { launchId: launch.id, projectId },
                            search: { status, tab: statusToLaunchTab(status) },
                            to: '/projects/$projectId/launches/$launchId',
                          })
                        }}
                        stats={launch.stats}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col items-start gap-2">
                        <span className={statusClassName(launch.status)}>{launch.status}</span>
                        {launch.status === 'running' ? (
                          <Button
                            disabled={completeRunMutation.isPending}
                            onClick={(event) => {
                              event.stopPropagation()
                              completeRunMutation.mutate(launch.id)
                            }}
                            size="sm"
                            variant="outline"
                          >
                            {completeRunMutation.isPending ? (
                              <>
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                Completing...
                              </>
                            ) : (
                              'Complete'
                            )}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[rgb(var(--app-muted))]">{total} launches matched the current search.</p>
          <div className="flex gap-2">
            <button
              className="rounded-full border border-[rgb(var(--app-line))] px-4 py-2 text-sm font-medium text-[rgb(var(--app-ink))] transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={search.page <= 1}
              onClick={() => goToPage(search.page - 1)}
              type="button"
            >
              Previous
            </button>
            <button
              className="rounded-full border border-[rgb(var(--app-line))] px-4 py-2 text-sm font-medium text-[rgb(var(--app-ink))] transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={search.page >= totalPages}
              onClick={() => goToPage(search.page + 1)}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <Dialog onOpenChange={setCreateRunOpen} open={createRunOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create launch</DialogTitle>
            <DialogDescription>
              Create a new empty launch. You can import results into it afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-launch-name">Run name</Label>
              <Input
                data-testid="launches-create-run-name"
                id="new-launch-name"
                onChange={(event) => setNewRunName(event.target.value)}
                placeholder="Nightly QA smoke"
                value={newRunName}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-launch-branch">Branch</Label>
                <Input
                  id="new-launch-branch"
                  onChange={(event) => setNewRunBranch(event.target.value)}
                  placeholder="main"
                  value={newRunBranch}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-launch-environment">Environment</Label>
                <Input
                  id="new-launch-environment"
                  onChange={(event) => setNewRunEnvironment(event.target.value)}
                  placeholder="staging"
                  value={newRunEnvironment}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-launch-tags">Tags</Label>
              <Input
                id="new-launch-tags"
                onChange={(event) => setNewRunTags(event.target.value)}
                placeholder="smoke, api"
                value={newRunTags}
              />
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setCreateRunOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={createRunMutation.isPending} onClick={() => createRunMutation.mutate()}>
              {createRunMutation.isPending ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create launch'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open && !importResultsMutation.isPending) {
            resetImportForm()
          }
        }}
        open={importOpen}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import Allure results</DialogTitle>
            <DialogDescription>
              All import modes now target the canonical `POST /api/v1/projects/:projectId/imports/allure-jobs` route.
              Choose whether to import from a workspace path, individual result files, or a CI zip archive.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="import-target-run">Import target</Label>
                <select
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-ring"
                  data-testid="launches-import-target-run"
                  id="import-target-run"
                  onChange={(event) => setImportTargetRunId(event.target.value)}
                  value={importTargetRunId}
                >
                  <option value="new">Create a new launch</option>
                  {launches.map((launch) => (
                    <option key={launch.id} value={launch.id}>
                      Merge into #{launch.id} - {launch.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs leading-6 text-muted-foreground">
                  Merge targets are limited to launches visible in the current filtered list.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="import-run-name">{importTargetRun ? 'New run name override (optional)' : 'Run name'}</Label>
                <Input
                  data-testid="launches-import-run-name"
                  id="import-run-name"
                  onChange={(event) => setImportRunName(event.target.value)}
                  placeholder={importTargetRun ? 'Optional when merging into an existing launch' : 'Nightly imported run'}
                  value={importRunName}
                />
              </div>
            </div>

            {importTargetRun ? (
              <Alert variant="warning">
                <AlertTitle>Merge mode</AlertTitle>
                <AlertDescription>
                  Imported results will merge into launch #{importTargetRun.id} ({importTargetRun.name}).
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="import-branch">Branch</Label>
                <Input
                  id="import-branch"
                  onChange={(event) => setImportBranch(event.target.value)}
                  placeholder="main"
                  value={importBranch}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="import-environment">Environment</Label>
                <Input
                  id="import-environment"
                  onChange={(event) => setImportEnvironment(event.target.value)}
                  placeholder="staging"
                  value={importEnvironment}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="import-tags">Tags</Label>
                <Input
                  id="import-tags"
                  onChange={(event) => setImportTags(event.target.value)}
                  placeholder="smoke, api"
                  value={importTags}
                />
              </div>
            </div>

            <Tabs onValueChange={(value) => setImportMode(value as ImportMode)} value={importMode}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="directory_path">
                  <FolderTree className="h-4 w-4" />
                  Path import
                </TabsTrigger>
                <TabsTrigger value="uploaded_files">
                  <Files className="h-4 w-4" />
                  Result files
                </TabsTrigger>
                <TabsTrigger value="ci_archive">
                  <FileArchive className="h-4 w-4" />
                  CI zip archive
                </TabsTrigger>
              </TabsList>

              <TabsContent value="directory_path">
                <div className="space-y-2 rounded-2xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/60 p-4">
                  <Label htmlFor="import-directory-path">Workspace directory path</Label>
                  <Input
                    data-testid="launches-import-directory-path"
                    id="import-directory-path"
                    onChange={(event) => setImportDirectoryPath(event.target.value)}
                    placeholder="C:\\reports\\allure-results"
                    value={importDirectoryPath}
                  />
                  <p className="text-xs leading-6 text-muted-foreground">
                    Enter the absolute path to the Allure results directory on the server.
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="uploaded_files">
                <div className="space-y-3 rounded-2xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/60 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => void handleDirectoryImportSelection()} size="sm" type="button" variant="outline">
                      <FolderOpen className="h-4 w-4" />
                      Select directory
                    </Button>
                    <p className="text-xs leading-6 text-muted-foreground">
                      Choose a local Allure results directory recursively, or fall back to explicit file picks below.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="import-result-files">Allure result files</Label>
                    <Input
                      data-testid="launches-import-result-files"
                      id="import-result-files"
                      multiple
                      onChange={(event) => setImportFiles(Array.from(event.target.files ?? []))}
                      type="file"
                    />
                    <input
                      className="hidden"
                      multiple
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? [])
                        if (files.length === 0) return
                        const normalized = files.map((file) => {
                          const relativePath = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, '/')
                          return relativePath !== file.name
                            ? new File([file], relativePath, { lastModified: file.lastModified, type: file.type })
                            : file
                        })
                        setImportArchiveFile(null)
                        setImportFiles(normalized)
                        setImportMode('uploaded_files')
                        event.currentTarget.value = ''
                      }}
                      ref={(node) => {
                        if (!node) return
                        node.setAttribute('webkitdirectory', '')
                        directoryInputRef.current = node
                      }}
                      type="file"
                    />
                  </div>
                  <p className="text-xs leading-6 text-muted-foreground">
                    Select one file for `uploaded_file` mode or several files for `uploaded_batch`. Directory-based
                    selection is also supported through the button above when the browser allows it.
                  </p>
                  {importFiles.length > 0 ? (
                    <div className="rounded-xl border border-[rgb(var(--app-line))] bg-white/80 px-3 py-3 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">{importFiles.length} file(s) queued</p>
                      <div className="mt-2 space-y-1">
                        {importFiles.slice(0, 5).map((file) => (
                          <p key={`${file.name}:${file.size}`}>{file.name}</p>
                        ))}
                        {importFiles.length > 5 ? <p>...and {importFiles.length - 5} more</p> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="ci_archive">
                <div className="space-y-3 rounded-2xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/60 p-4">
                  <div className="space-y-2">
                    <Label htmlFor="import-archive-file">Allure zip archive</Label>
                    <Input
                      accept=".zip,application/zip,application/x-zip-compressed"
                      data-testid="launches-import-archive-file"
                      id="import-archive-file"
                      onChange={(event) => setImportArchiveFile(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                  </div>
                  <p className="text-xs leading-6 text-muted-foreground">
                    Use this mode for CI artifacts where the Allure results directory is already packed as a single zip
                    archive.
                  </p>
                  {importArchiveFile ? (
                    <div className="rounded-xl border border-[rgb(var(--app-line))] bg-white/80 px-3 py-3 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">Archive ready</p>
                      <p className="mt-1">{importArchiveFile.name}</p>
                    </div>
                  ) : null}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter>
            <Button onClick={() => setImportOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={importResultsMutation.isPending} onClick={() => importResultsMutation.mutate()}>
              {importResultsMutation.isPending ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                'Import results'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LaunchFiltersDialog({
  onApply,
  onClear,
  onClose,
  open,
  search,
}: {
  onApply: (nextSearch: typeof search) => void
  onClear: () => void
  onClose: () => void
  open: boolean
  search: ReturnType<typeof projectLaunchesRoute.useSearch>
}) {
  const [searchInput, setSearchInput] = useState(search.search ?? '')
  const [branchInput, setBranchInput] = useState(search.branch ?? '')
  const [dateFromInput, setDateFromInput] = useState(searchValueToDateInput(search.dateFrom))
  const [dateToInput, setDateToInput] = useState(searchValueToDateInput(search.dateTo))
  const [statusInput, setStatusInput] = useState(search.status ?? '')

  const applyFilters = () => {
    onApply({
      branch: branchInput.trim() || undefined,
      dateFrom: normalizeDateInputToSearchValue(dateFromInput, 'start'),
      dateTo: normalizeDateInputToSearchValue(dateToInput, 'end'),
      limit: search.limit,
      page: 1,
      search: searchInput.trim() || undefined,
      sortBy: search.sortBy,
      sortOrder: search.sortOrder,
      status: statusInput ? (statusInput as typeof search.status) : undefined,
    })
    onClose()
  }

  const clearAll = () => {
    setSearchInput('')
    setBranchInput('')
    setDateFromInput('')
    setDateToInput('')
    setStatusInput('')
    onClear()
    onClose()
  }

  return (
    <Dialog onOpenChange={(next) => { if (!next) onClose() }} open={open}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Filters</DialogTitle>
          <DialogDescription>Narrow down launches by name, branch, status, or time window.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="launch-filter-search">Search</Label>
            <Input
              id="launch-filter-search"
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && applyFilters()}
              placeholder="Launch name"
              type="search"
              value={searchInput}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="launch-filter-branch">Branch</Label>
              <Input
                id="launch-filter-branch"
                onChange={(event) => setBranchInput(event.target.value)}
                placeholder="main"
                value={branchInput}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="launch-filter-status">Status</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-ring"
                id="launch-filter-status"
                onChange={(event) => setStatusInput(event.target.value)}
                value={statusInput}
              >
                <option value="">All</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="running">Running</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="launch-filter-date-from">Date from</Label>
              <Input
                id="launch-filter-date-from"
                max={dateToInput || undefined}
                onChange={(event) => setDateFromInput(event.target.value)}
                type="date"
                value={dateFromInput}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="launch-filter-date-to">Date to</Label>
              <Input
                id="launch-filter-date-to"
                min={dateFromInput || undefined}
                onChange={(event) => setDateToInput(event.target.value)}
                type="date"
                value={dateToInput}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={clearAll} variant="outline">Clear all</Button>
          <Button onClick={applyFilters}>Apply filters</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatDateTime(value: null | string) {
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

function statusClassName(status: string) {
  const toneClassName =
    status === 'completed'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'failed'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-blue-200 bg-blue-50 text-blue-700'

  return `inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${toneClassName}`
}

function statusToLaunchTab(status: 'broken' | 'failed' | 'passed' | 'skipped') {
  return status === 'broken' || status === 'failed' ? 'defects' : 'tests'
}

function LaunchTestBar({
  onSegmentClick,
  stats,
}: {
  onSegmentClick?: (status: 'broken' | 'failed' | 'passed' | 'skipped') => void
  stats: { broken: number; failed: number; passRate: number; passed: number; skipped: number; total: number }
}) {
  const total = Math.max(stats.total, 0)
  const denominator = Math.max(total, 1)
  const passedWidth = `${(stats.passed / denominator) * 100}%`
  const failedWidth = `${(stats.failed / denominator) * 100}%`
  const brokenWidth = `${(stats.broken / denominator) * 100}%`
  const skippedWidth = `${(stats.skipped / denominator) * 100}%`
  const unstableTotal = stats.failed + stats.broken
  const segments = [
    { active: stats.passed > 0, color: 'bg-emerald-500', count: stats.passed, label: 'Passed', status: 'passed' as const, width: passedWidth },
    { active: stats.failed > 0, color: 'bg-red-500', count: stats.failed, label: 'Failed', status: 'failed' as const, width: failedWidth },
    { active: stats.broken > 0, color: 'bg-amber-500', count: stats.broken, label: 'Broken', status: 'broken' as const, width: brokenWidth },
    { active: stats.skipped > 0, color: 'bg-slate-400', count: stats.skipped, label: 'Skipped', status: 'skipped' as const, width: skippedWidth },
  ]

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs text-[rgb(var(--app-muted))]">
        <span>{total} tests</span>
        <span>{stats.passed} passed</span>
      </div>
      <div className="group relative flex h-3 overflow-hidden rounded-full border border-[rgb(var(--app-line))] bg-[linear-gradient(180deg,rgba(255,255,255,0.8),rgba(248,250,252,0.9))] p-0.5 shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] transition-all duration-300 hover:shadow-[inset_0_1px_2px_rgba(15,23,42,0.08),0_10px_24px_rgba(15,23,42,0.08)]">
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(255,255,255,0.85),transparent_38%),linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        {segments.map((segment) => (
          <button
            aria-label={`${segment.label}: ${segment.count}`}
            className={`group relative isolate h-full overflow-hidden rounded-full transition-all duration-300 ease-out ${segment.active ? 'cursor-pointer hover:-translate-y-[1px] hover:brightness-110 hover:saturate-150 active:translate-y-0 active:scale-[0.99]' : 'cursor-default opacity-55'} focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--app-accent))]/40`}
            key={segment.status}
            onClick={(event) => {
              event.stopPropagation()
              if (segment.active) {
                onSegmentClick?.(segment.status)
              }
            }}
            onKeyDown={(event) => {
              if (!segment.active) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSegmentClick?.(segment.status)
              }
            }}
            title={`${segment.label}: ${segment.count}`}
            type="button"
            style={{ width: segment.width }}
          >
            <span className={`absolute inset-0 ${segment.color} transition-transform duration-300 group-hover:scale-y-[1.15]`} />
            <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.25),transparent_40%,rgba(0,0,0,0.05))] opacity-75 transition-opacity duration-300 group-hover:opacity-100" />
            <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <span className="absolute inset-y-0 left-0 w-1/3 bg-white/20 blur-md" />
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-[rgb(var(--app-muted))]">
        <span>{stats.passed} passed</span>
        <span>{unstableTotal} unstable</span>
        <span>{stats.skipped} skipped</span>
      </div>
    </div>
  )
}

function parseTagInput(value: string) {
  const tags = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  return tags.length > 0 ? tags : undefined
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
