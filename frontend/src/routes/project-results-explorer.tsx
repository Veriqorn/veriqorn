import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  LoaderCircle,
  Paperclip,
  RotateCcw,
  Search,
} from 'lucide-react'
import { type ComponentType, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import type { ApiClient } from '@/lib/api'
import { isRecord, unwrapApiData } from '@/lib/api'
import { encodeProjectId } from '@/lib/project-paths'
import { env } from '@/lib/env'
import { useRuntime } from '@/providers/runtime-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getAiLicenseConfigQueryOptions, getCapabilitiesQueryOptions } from '@/lib/queries'
import { isFrontendContributionEntitled, loadFrontendExtensions, resultDetailContributions, type LoadedFrontendExtension } from '@/extensions/registry'
import type {
  TestAttachment,
  TestResult,
  TestResultsResponse,
  TestStep,
} from '@/types'

type ViewTab = 'defects' | 'tests' | 'timeline'
type DetailTab = string
type ExpandCommand = { mode: 'all' | 'none'; token: number }

type TestRerunSelectionMode = 'failed_or_broken' | 'selected' | 'single'

type TestRerunSelector = {
  kind: 'allureId' | 'frameworkId' | 'historyId' | 'testName'
  testResultId?: string
  value: string
}

type TestRerunActionRequest = {
  selectionMode: TestRerunSelectionMode
  selectors: TestRerunSelector[]
  sourceResultIds?: string[]
}

type TestRerunJobResponse = {
  childRunId?: number
  createdAt: string
  executionMode: string
  framework: string
  jobId: string
  message?: string
  parentRunId: number
  projectId: string
  selectionMode: TestRerunSelectionMode
  selectors: TestRerunSelector[]
  startedAt?: string
  status: 'canceled' | 'completed' | 'failed' | 'queued' | 'running'
  updatedAt: string
}

interface LaunchResultsExplorerProps {
  launchId: string
  onSelectResult: (resultId: string) => void
  onTabChange: (tab: ViewTab) => void
  projectId: string
  resultsResponse: TestResultsResponse
  search: { resultId?: string; status?: 'broken' | 'failed' | 'passed' | 'skipped'; tab: ViewTab }
  showViewTabs?: boolean
}

const STATUS_DOT: Record<string, string> = {
  broken: 'bg-amber-400',
  failed: 'bg-red-500',
  passed: 'bg-emerald-500',
  skipped: 'bg-slate-400',
}

const STATUS_BADGE: Record<string, string> = {
  broken: 'border-amber-200 bg-amber-50 text-amber-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
  passed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  skipped: 'border-slate-200 bg-slate-50 text-slate-600',
}

const RERUN_TERMINAL_STATUSES = new Set(['canceled', 'completed', 'failed'])

const isUnstableResult = (result: TestResult) => result.status === 'broken' || result.status === 'failed'

const getStepChildren = (step: TestStep) => step.childSteps ?? []

const getStepAttachments = (step: TestStep) => step.attachments ?? []

const isTraceAttachment = (attachment: TestAttachment) => {
  if (attachment.isTrace) return true
  const haystack = `${attachment.name} ${attachment.type} ${attachment.source}`.toLowerCase()
  return haystack.includes('trace') || haystack.includes('.trace') || haystack.includes('.zip') || haystack.includes('application/zip')
}

const resolveRerunSelector = (result: TestResult): null | TestRerunSelector => {
  const allureId = String(result.allureId ?? '').trim()
  if (allureId) {
    return { kind: 'allureId', testResultId: result.id, value: allureId }
  }

  const historyId = String(result.historyId ?? '').trim()
  if (historyId) {
    return { kind: 'historyId', testResultId: result.id, value: historyId }
  }

  const frameworkId = String(result.uuid ?? '').trim()
  if (frameworkId) {
    return { kind: 'frameworkId', testResultId: result.id, value: frameworkId }
  }

  const testName = String(result.name ?? '').trim()
  if (testName) {
    return { kind: 'testName', testResultId: result.id, value: testName }
  }

  return null
}

const buildRerunSelectors = (results: TestResult[]) => {
  const unique = new Map<string, TestRerunSelector>()

  results.forEach((result) => {
    const selector = resolveRerunSelector(result)
    if (!selector) return
    const dedupeKey = `${selector.kind}:${selector.value}`
    if (!unique.has(dedupeKey)) {
      unique.set(dedupeKey, selector)
    }
  })

  return Array.from(unique.values())
}

function StatusDot({ status }: { status: string }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status] ?? 'bg-slate-400'}`} />
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[status] ?? 'border-slate-200 bg-slate-50 text-slate-600'}`}>
      {status}
    </span>
  )
}

function fmt(ms?: number): null | string {
  if (!ms || ms <= 0) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

function fmtDate(value?: string): null | string {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

function fmtClock(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function fmtTimelineElapsed(ms: number) {
  if (ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) {
    const seconds = ms / 1000
    return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`
  }
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return 'n/a'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function stepDuration(step: TestStep): null | number {
  if (step.startTime && step.endTime) {
    const ms = new Date(step.endTime).getTime() - new Date(step.startTime).getTime()
    return ms > 0 ? ms : null
  }
  return null
}

function getParamEntries(result: TestResult): Array<{ key: string; value: string }> {
  const { parameters } = result
  if (Array.isArray(parameters)) {
    return parameters.flatMap((entry, i) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const record = entry as Record<string, unknown>
        if (typeof record.name === 'string' || record.value !== undefined) {
          return [{ key: typeof record.name === 'string' && record.name ? record.name : `param_${i + 1}`, value: fmtVal(record.value) }]
        }
        return Object.entries(record).map(([key, value]) => ({ key, value: fmtVal(value) }))
      }
      return [{ key: `param_${i + 1}`, value: fmtVal(entry) }]
    })
  }

  if (parameters && typeof parameters === 'object') {
    return Object.entries(parameters as Record<string, unknown>).map(([key, value]) => ({ key, value: fmtVal(value) }))
  }

  return []
}

function collectAttachments(steps: TestStep[]) {
  const queue = [...steps]
  const out: TestAttachment[] = []

  while (queue.length > 0) {
    const step = queue.shift()
    if (!step) continue
    out.push(...getStepAttachments(step))
    queue.push(...getStepChildren(step))
  }

  return out
}

function normalizeGroupingText(value: string | undefined | null) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function getResultDisplayId(result: TestResult) {
  const allureId = String(result.allureId ?? '').trim()
  return allureId || 'n/a'
}

function getDefectSignature(result: TestResult) {
  const failedStepName = normalizeGroupingText(result.diagnostics?.failedStepName)
  const message = normalizeGroupingText(result.diagnostics?.message)
  const stackTrace = normalizeGroupingText(result.diagnostics?.stackTrace)
  const stackHead = stackTrace.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  return [failedStepName, message, stackHead].filter(Boolean).join('||') || result.name
}

type TimelineLaneEntry = {
  durationMs: number
  endMs: number
  leftPercent: number
  result: TestResult
  startMs: number
  widthPercent: number
}

type TimelineLane = {
  id: number
  items: TimelineLaneEntry[]
}

type TimelineModel = {
  lanes: TimelineLane[]
  maxEndMs: number
  minStartMs: number
  totalDurationMs: number
}

function buildTimelineModel(results: TestResult[]): TimelineModel {
  const stamped = results
    .map((result, index) => {
      const startMs = result.startTime ? new Date(result.startTime).getTime() : Number.NaN
      if (!Number.isFinite(startMs)) return null
      const durationMs = Math.max(Number.isFinite(result.duration) ? (result.duration ?? 1) : 1, 1)
      const endMs = result.endTime ? new Date(result.endTime).getTime() : startMs + durationMs
      return { durationMs, endMs, index, result, startMs }
    })
    .filter((entry): entry is { durationMs: number; endMs: number; index: number; result: TestResult; startMs: number } => Boolean(entry))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.index - right.index)

  if (!stamped.length) {
    return {
      lanes: [],
      maxEndMs: 0,
      minStartMs: 0,
      totalDurationMs: 0,
    }
  }

  const minStart = Math.min(...stamped.map((entry) => entry.startMs))
  const maxEnd = Math.max(...stamped.map((entry) => entry.endMs))
  const totalDuration = Math.max(maxEnd - minStart, 1)
  const lanes: Array<{ lastEnd: number; items: TimelineLaneEntry[] }> = []

  stamped.forEach((entry) => {
    const rawLeftPercent = Math.min(Math.max(((entry.startMs - minStart) / totalDuration) * 100, 0), 100)
    const endPercent = Math.min(Math.max(((entry.endMs - minStart) / totalDuration) * 100, 0), 100)
    const widthPercent = Math.max(endPercent - rawLeftPercent, 0.5)
    const leftPercent = Math.min(rawLeftPercent, 100 - widthPercent)
    const laneIndex = lanes.findIndex((lane) => lane.items.length === 0 || lane.lastEnd <= entry.startMs)
    const targetIndex = laneIndex >= 0 ? laneIndex : lanes.length
    if (!lanes[targetIndex]) {
      lanes[targetIndex] = { items: [], lastEnd: entry.endMs }
    }
    lanes[targetIndex].items.push({
      durationMs: entry.durationMs,
      endMs: entry.endMs,
      leftPercent,
      result: entry.result,
      startMs: entry.startMs,
      widthPercent,
    })
    lanes[targetIndex].lastEnd = Math.max(lanes[targetIndex].lastEnd, entry.endMs)
  })

  return {
    lanes: lanes.map((lane, id): TimelineLane => ({
      id,
      items: lane.items.sort((left, right) => left.leftPercent - right.leftPercent),
    })),
    maxEndMs: maxEnd,
    minStartMs: minStart,
    totalDurationMs: totalDuration,
  }
}

function buildEnabledStatuses(status?: 'broken' | 'failed' | 'passed' | 'skipped') {
  return {
    broken: status ? status === 'broken' : true,
    failed: status ? status === 'failed' : true,
    passed: status ? status === 'passed' : true,
    skipped: status ? status === 'skipped' : true,
  }
}

function isResultStatusEnabled(enabledStatuses: ReturnType<typeof buildEnabledStatuses>, status: string) {
  return status in enabledStatuses ? enabledStatuses[status as keyof typeof enabledStatuses] !== false : true
}

type DefectGroup = {
  key: string
  primaryResult: TestResult
  results: TestResult[]
}

function buildDefectGroups(results: TestResult[]) {
  const groups = new Map<string, DefectGroup>()

  results.forEach((result) => {
    if (!isUnstableResult(result)) return

    const key = getDefectSignature(result)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        key,
        primaryResult: result,
        results: [result],
      })
      return
    }

    existing.results.push(result)
    if ((result.duration ?? 0) > (existing.primaryResult.duration ?? 0)) {
      existing.primaryResult = result
    }
  })

  return Array.from(groups.values()).sort((left, right) => {
    return right.results.length - left.results.length || (right.primaryResult.duration ?? 0) - (left.primaryResult.duration ?? 0) || left.primaryResult.name.localeCompare(right.primaryResult.name)
  })
}

function buildAttachmentBaseUrl(projectId: string, launchId: string, resultId: string) {
  return `/api/v1/projects/${encodeProjectId(projectId)}/runs/${encodeURIComponent(launchId)}/results#${encodeURIComponent(resultId)}`
}

export { buildAttachmentBaseUrl }

export function buildAttachmentDownloadUrl(projectId: string, launchId: string, attachmentId: string) {
  return `${env.apiUrl}/api/v1/projects/${encodeProjectId(projectId)}/runs/${encodeURIComponent(launchId)}/attachments/${encodeURIComponent(attachmentId)}`
}

function buildRunResultsUrl(projectId: string, launchId: string) {
  return `/api/v1/projects/${encodeProjectId(projectId)}/runs/${encodeURIComponent(launchId)}/results`
}

function extractTraceAttachmentFromPayload(payload: unknown, attachmentId: string): null | TestAttachment {
  const normalized = unwrapApiData(payload)
  if (!isRecord(normalized) || !Array.isArray(normalized.items)) {
    return null
  }

  const resultQueue = [...normalized.items]
  while (resultQueue.length > 0) {
    const result = resultQueue.shift()
    if (!isRecord(result) || !Array.isArray(result.steps)) continue

    const stepQueue = [...result.steps]
    while (stepQueue.length > 0) {
      const step = stepQueue.shift()
      if (!isRecord(step)) continue

      if (Array.isArray(step.attachments)) {
        for (const attachment of step.attachments) {
          if (!isRecord(attachment) || typeof attachment.id !== 'string' || attachment.id !== attachmentId) continue
          return {
            id: attachment.id,
            isTrace: Boolean(attachment.isTrace),
            name: typeof attachment.name === 'string' && attachment.name ? attachment.name : 'Attachment',
            source: typeof attachment.source === 'string' ? attachment.source : '',
            traceAssetUrl: typeof attachment.traceAssetUrl === 'string' ? attachment.traceAssetUrl : undefined,
            traceTokenExpiresAt: typeof attachment.traceTokenExpiresAt === 'string' ? attachment.traceTokenExpiresAt : undefined,
            traceViewerUrl: typeof attachment.traceViewerUrl === 'string' ? attachment.traceViewerUrl : undefined,
            type: typeof attachment.type === 'string' && attachment.type ? attachment.type : 'application/octet-stream',
          }
        }
      }

      if (Array.isArray(step.childSteps)) {
        stepQueue.push(...step.childSteps)
      }
    }
  }

  return null
}

function CompactStep({
  depth = 0,
  expandCommand,
  launchId,
  inlinePreviews,
  onOpenAttachmentPreview,
  onToggleInlineAttachmentPreview,
  projectId,
  stepNumber,
  step,
}: {
  depth?: number
  expandCommand: ExpandCommand
  launchId: string
  inlinePreviews: Record<string, AttachmentPreviewState | null>
  onOpenAttachmentPreview: (attachment: TestAttachment) => Promise<void> | void
  onToggleInlineAttachmentPreview: (attachment: TestAttachment) => Promise<void> | void
  projectId: string
  stepNumber: number[]
  step: TestStep
}) {
  const [open, setOpen] = useState(false)

  const children = getStepChildren(step)
  const attachments = getStepAttachments(step)
  const hasChildren = children.length > 0
  const hasDetails = Boolean(step.statusDetails?.message) || Boolean(step.statusDetails?.trace) || attachments.length > 0
  const canExpand = hasChildren || hasDetails
  const duration = fmt(stepDuration(step) ?? undefined)

  useEffect(() => {
    setOpen(expandCommand.mode === 'all')
  }, [expandCommand])

  return (
    <li>
      <button
        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-[rgb(var(--app-surface))]"
        disabled={!canExpand}
        onClick={() => canExpand && setOpen((value) => !value)}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        type="button"
      >
        <span className="w-3 shrink-0 text-[rgb(var(--app-muted))]">
          {canExpand ? (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : null}
        </span>
        <span className="min-w-8 shrink-0 rounded-full border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[rgb(var(--app-muted))]">
          <span className="mr-0.5 text-[rgb(var(--app-muted))]">#</span>
          {stepNumber.join('.')}
        </span>
        <StatusDot status={step.status ?? 'unknown'} />
        <span className="min-w-0 flex-1 truncate text-sm text-[rgb(var(--app-ink))]">{step.name}</span>
        {attachments.length > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-[rgb(var(--app-muted))]">
            <Paperclip className="h-2.5 w-2.5" />
            {attachments.length}
          </span>
        )}
        {duration ? <span className="shrink-0 text-[11px] text-[rgb(var(--app-muted))]">{duration}</span> : null}
      </button>

      {open && (
        <div className="mt-0.5">
          {step.statusDetails?.message && (
            <div className="mb-1 rounded-md border border-red-200 bg-red-50/80 px-3 py-2 text-xs leading-5 text-red-800" style={{ marginLeft: `${24 + depth * 16}px` }}>
              {step.statusDetails.message}
              {step.statusDetails.trace && (
                <pre className="mt-2 overflow-x-auto text-[10px] leading-4 text-red-700 opacity-80">{String(step.statusDetails.trace)}</pre>
              )}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="mb-2 space-y-2" style={{ marginLeft: `${24 + depth * 16}px` }}>
              {attachments.map((attachment) => {
                const inlinePreview = inlinePreviews[attachment.id]
                return (
                  <div className="space-y-2 rounded-lg border border-[rgb(var(--app-line))] bg-white/80 px-3 py-2" key={attachment.id}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[rgb(var(--app-ink))]">{attachment.name}</p>
                        <p className="text-[10px] text-[rgb(var(--app-muted))]">{attachment.type}</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {isPreviewableAttachment(attachment) ? (
                          <>
                            <Button onClick={() => void onToggleInlineAttachmentPreview(attachment)} size="sm" type="button" variant="outline">
                              {inlinePreview ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              Preview
                            </Button>
                            <Button onClick={() => void onOpenAttachmentPreview(attachment)} size="sm" type="button" variant="outline">
                              Open
                            </Button>
                          </>
                        ) : null}
                        <Button asChild size="sm" variant="outline">
                          <a download href={buildAttachmentDownloadUrl(projectId, launchId, attachment.id)}>
                            Download
                          </a>
                        </Button>
                      </div>
                    </div>
                    {inlinePreview ? (
                      <div className="rounded-xl border border-dashed border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/60 p-3">
                        <AttachmentPreviewSurface preview={inlinePreview} variant="inline" />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
          {hasChildren && (
            <ol>
              {children.map((child, index) => (
                <CompactStep
                  depth={depth + 1}
                  expandCommand={expandCommand}
                  key={child.id}
                  launchId={launchId}
                  inlinePreviews={inlinePreviews}
                  onOpenAttachmentPreview={onOpenAttachmentPreview}
                  onToggleInlineAttachmentPreview={onToggleInlineAttachmentPreview}
                  projectId={projectId}
                  step={child}
                  stepNumber={[...stepNumber, index + 1]}
                />
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  )
}

function ExecutionSteps({
  launchId,
  inlinePreviews,
  onOpenAttachmentPreview,
  onToggleInlineAttachmentPreview,
  projectId,
  steps,
}: {
  launchId: string
  inlinePreviews: Record<string, AttachmentPreviewState | null>
  onOpenAttachmentPreview: (attachment: TestAttachment) => Promise<void> | void
  onToggleInlineAttachmentPreview: (attachment: TestAttachment) => Promise<void> | void
  projectId: string
  steps: TestStep[]
}) {
  const [expandCommand, setExpandCommand] = useState<ExpandCommand>({ mode: 'none', token: 0 })

  if (steps.length === 0) {
    return <p className="text-sm text-[rgb(var(--app-muted))]">No execution steps.</p>
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button
          className="flex items-center gap-1 rounded-full border border-[rgb(var(--app-line))] px-2.5 py-1 text-xs text-[rgb(var(--app-muted))] transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))]"
          onClick={() => setExpandCommand((current) => ({ mode: 'all', token: current.token + 1 }))}
          type="button"
        >
          <ChevronsUpDown className="h-3 w-3" />
          Expand all
        </button>
        <button
          className="flex items-center gap-1 rounded-full border border-[rgb(var(--app-line))] px-2.5 py-1 text-xs text-[rgb(var(--app-muted))] transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))]"
          onClick={() => setExpandCommand((current) => ({ mode: 'none', token: current.token + 1 }))}
          type="button"
        >
          <ChevronsDownUp className="h-3 w-3" />
          Collapse all
        </button>
        <span className="text-xs text-[rgb(var(--app-muted))]">{steps.length} steps</span>
      </div>
      <ol>
        {steps.map((step, index) => (
          <CompactStep
            expandCommand={expandCommand}
            key={`${step.id}:${expandCommand.token}`}
            launchId={launchId}
            inlinePreviews={inlinePreviews}
            onOpenAttachmentPreview={onOpenAttachmentPreview}
            onToggleInlineAttachmentPreview={onToggleInlineAttachmentPreview}
            projectId={projectId}
            step={step}
            stepNumber={[index + 1]}
          />
        ))}
      </ol>
    </div>
  )
}

function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--app-muted))]">{title}</p>
      {children}
    </div>
  )
}

function RunList({
  emptyText,
  items,
  launchId,
  projectId,
}: {
  emptyText: string
  items: Array<{ duration?: number; id: string; startTime: string; status: string; testRunId?: string }>
  launchId: string
  projectId: string
}) {
  if (items.length === 0) {
    return <p className="text-sm text-[rgb(var(--app-muted))]">{emptyText}</p>
  }

  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div className="flex items-center gap-3 rounded-lg border border-[rgb(var(--app-line))] bg-white/80 px-3 py-2" key={item.id}>
          <StatusBadge status={item.status} />
          <span className="flex-1 truncate text-xs text-[rgb(var(--app-muted))]">{fmtDate(item.startTime)}</span>
          {item.duration ? <span className="shrink-0 text-xs text-[rgb(var(--app-muted))]">{fmt(item.duration)}</span> : null}
          {item.testRunId ? (
            <Link
              className="shrink-0 text-xs text-[rgb(var(--app-accent))] hover:underline"
              params={{ launchId: item.testRunId, projectId }}
              search={{ resultId: item.id, tab: 'tests' }}
              to="/projects/$projectId/launches/$launchId"
            >
              {item.testRunId === launchId ? 'Open result' : 'Open launch'}
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  )
}

type AttachmentPreviewKind = 'html' | 'image' | 'text' | 'video'

type ResolvedAttachmentPreviewKind = AttachmentPreviewKind | 'trace'

type AttachmentPreviewState = {
  attachment: TestAttachment
  error?: string
  kind: ResolvedAttachmentPreviewKind
  loading: boolean
  objectUrl?: string
  text?: string
  viewerUrl?: string
}

const TEXT_ATTACHMENT_EXTENSIONS = ['.csv', '.json', '.log', '.md', '.txt', '.xml', '.yaml', '.yml']
const IMAGE_ATTACHMENT_EXTENSIONS = ['.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']
const VIDEO_ATTACHMENT_EXTENSIONS = ['.mov', '.mp4', '.webm']

export function inferAttachmentPreviewKind(attachment: TestAttachment): AttachmentPreviewKind | null {
  const type = (attachment.type || '').toLowerCase()
  const name = `${attachment.name || ''} ${attachment.source || ''}`.toLowerCase()

  if (type.startsWith('image/') || IMAGE_ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext) || name.includes(`${ext} `))) {
    return 'image'
  }
  if (type.startsWith('video/') || VIDEO_ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext) || name.includes(`${ext} `))) {
    return 'video'
  }
  if (type.includes('html') || name.endsWith('.html') || name.endsWith('.htm')) {
    return 'html'
  }
  if (
    type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('xml') ||
    TEXT_ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext) || name.includes(`${ext} `))
  ) {
    return 'text'
  }

  return null
}

function isPreviewableAttachment(attachment: TestAttachment) {
  return Boolean(attachment.isTrace || attachment.traceViewerUrl || attachment.traceAssetUrl || inferAttachmentPreviewKind(attachment))
}

function AttachmentPreviewSurface({
  preview,
  variant,
}: {
  preview: AttachmentPreviewState
  variant: 'dialog' | 'inline'
}) {
  const mediaHeightClass = variant === 'dialog' ? 'max-h-[84vh]' : 'max-h-[360px]'
  const frameHeightClass = variant === 'dialog' ? 'h-[84vh]' : 'h-[360px]'
  const traceHeightClass = variant === 'dialog' ? 'h-[88vh]' : 'h-[380px]'

  if (preview.loading) {
    return (
      <div className={`flex items-center justify-center text-sm text-[rgb(var(--app-muted))] ${variant === 'dialog' ? 'min-h-64' : 'min-h-40 rounded-xl border border-[rgb(var(--app-line))] bg-white/90'}`}>
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
        Loading preview...
      </div>
    )
  }

  if (preview.error) {
    return <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{preview.error}</div>
  }

  if (preview.kind === 'trace') {
    return preview.viewerUrl ? (
      <div className={`${traceHeightClass} overflow-hidden rounded-xl border border-[rgb(var(--app-line))] bg-[#0f172a] p-2`}>
        <iframe className="h-full w-full rounded-lg border border-white/10 bg-white" sandbox="allow-downloads allow-scripts" src={preview.viewerUrl} title="Playwright Trace Viewer" />
      </div>
    ) : (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Trace viewer URL is unavailable.</div>
    )
  }

  if (preview.kind === 'image' && preview.objectUrl) {
    return <img alt={preview.attachment.name || 'Attachment preview'} className={`mx-auto max-w-full rounded-lg border border-[rgb(var(--app-line))] bg-white object-contain ${mediaHeightClass}`} src={preview.objectUrl} />
  }

  if (preview.kind === 'video' && preview.objectUrl) {
    return <video className={`mx-auto w-full rounded-lg border border-[rgb(var(--app-line))] bg-black object-contain ${mediaHeightClass}`} controls src={preview.objectUrl} />
  }

  if (preview.kind === 'html') {
    return <iframe className={`${frameHeightClass} w-full rounded-lg border border-[rgb(var(--app-line))] bg-white`} sandbox="" srcDoc={preview.text || ''} title="HTML attachment preview" />
  }

  if (preview.kind === 'text') {
    return <pre className={`${variant === 'dialog' ? 'max-h-[84vh]' : 'max-h-[360px]'} overflow-auto rounded-lg border border-[rgb(var(--app-line))] bg-white px-4 py-3 text-xs leading-5 text-[rgb(var(--app-ink))]`}>{preview.text || ''}</pre>
  }

  return null
}

function useAttachmentPreviewState(apiClient: ApiClient, projectId: string, launchId: string) {
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewState | null>(null)
  const [inlinePreviews, setInlinePreviews] = useState<Record<string, AttachmentPreviewState | null>>({})
  const modalPreviewRef = useRef<AttachmentPreviewState | null>(null)
  const inlinePreviewRef = useRef<Record<string, AttachmentPreviewState | null>>({})

  const revokePreviewObjectUrl = (preview: AttachmentPreviewState | null | undefined) => {
    if (preview?.objectUrl) {
      URL.revokeObjectURL(preview.objectUrl)
    }
  }

  const replaceAttachmentPreview = (next: AttachmentPreviewState | null) => {
    setAttachmentPreview((current) => {
      if (current?.objectUrl && current.objectUrl !== next?.objectUrl) {
        URL.revokeObjectURL(current.objectUrl)
      }
      return next
    })
  }

  const replaceInlinePreview = (attachmentId: string, next: AttachmentPreviewState | null) => {
    setInlinePreviews((current) => {
      const previous = current[attachmentId]
      if (previous?.objectUrl && previous.objectUrl !== next?.objectUrl) {
        URL.revokeObjectURL(previous.objectUrl)
      }
      return { ...current, [attachmentId]: next }
    })
  }

  useEffect(() => {
    modalPreviewRef.current = attachmentPreview
  }, [attachmentPreview])

  useEffect(() => {
    inlinePreviewRef.current = inlinePreviews
  }, [inlinePreviews])

  useEffect(
    () => () => {
      revokePreviewObjectUrl(modalPreviewRef.current)
      Object.values(inlinePreviewRef.current).forEach((preview) => revokePreviewObjectUrl(preview))
    },
    [],
  )

  const closeAttachmentPreview = () => replaceAttachmentPreview(null)

  const clearInlinePreviews = () => {
    setInlinePreviews((current) => {
      Object.values(current).forEach((preview) => revokePreviewObjectUrl(preview))
      return {}
    })
  }

  const resolveAttachmentPreview = async (attachment: TestAttachment): Promise<AttachmentPreviewState> => {
    if (attachment.isTrace || attachment.traceViewerUrl || attachment.traceAssetUrl) {
      const payload = await apiClient.get<unknown>(buildRunResultsUrl(projectId, launchId))
      const refreshedAttachment = extractTraceAttachmentFromPayload(payload, attachment.id) ?? attachment
      if (!refreshedAttachment.traceViewerUrl) {
        throw new Error('Trace preview URL is unavailable. Refresh launch details and try again.')
      }
      return {
        attachment: refreshedAttachment,
        kind: 'trace',
        loading: false,
        viewerUrl: refreshedAttachment.traceViewerUrl,
      }
    }

    const kind = inferAttachmentPreviewKind(attachment)
    if (!kind) {
      throw new Error('Preview is unavailable for this attachment type.')
    }

    const response = await fetch(buildAttachmentDownloadUrl(projectId, launchId, attachment.id), { credentials: 'include' })
    if (!response.ok) {
      throw new Error(`Preview failed with HTTP ${response.status}`)
    }

    if (kind === 'image' || kind === 'video') {
      const objectUrl = URL.createObjectURL(await response.blob())
      return { attachment, kind, loading: false, objectUrl }
    }

    const text = await response.text()
    return { attachment, kind, loading: false, text }
  }

  const openAttachmentPreview = async (attachment: TestAttachment) => {
    if (!isPreviewableAttachment(attachment)) return

    const kind: ResolvedAttachmentPreviewKind = attachment.isTrace || attachment.traceViewerUrl || attachment.traceAssetUrl ? 'trace' : inferAttachmentPreviewKind(attachment) ?? 'text'
    replaceAttachmentPreview({ attachment, kind, loading: true })

    try {
      replaceAttachmentPreview(await resolveAttachmentPreview(attachment))
    } catch (error) {
      replaceAttachmentPreview({
        attachment,
        error: error instanceof Error ? error.message : 'Preview failed.',
        kind,
        loading: false,
      })
    }
  }

  const toggleInlineAttachmentPreview = async (attachment: TestAttachment) => {
    if (!isPreviewableAttachment(attachment)) return
    if (inlinePreviewRef.current[attachment.id]) {
      replaceInlinePreview(attachment.id, null)
      return
    }

    const kind: ResolvedAttachmentPreviewKind = attachment.isTrace || attachment.traceViewerUrl || attachment.traceAssetUrl ? 'trace' : inferAttachmentPreviewKind(attachment) ?? 'text'
    replaceInlinePreview(attachment.id, { attachment, kind, loading: true })

    try {
      replaceInlinePreview(attachment.id, await resolveAttachmentPreview(attachment))
    } catch (error) {
      replaceInlinePreview(attachment.id, {
        attachment,
        error: error instanceof Error ? error.message : 'Preview failed.',
        kind,
        loading: false,
      })
    }
  }

  const dialogs = (
    <Dialog onOpenChange={(open) => !open && closeAttachmentPreview()} open={attachmentPreview !== null}>
      <DialogContent className="max-h-[96vh] w-[98vw] max-w-[98vw] overflow-hidden p-0 md:w-[96vw] xl:w-[1700px] xl:max-w-[98vw]">
        <DialogHeader className="border-b border-[rgb(var(--app-line))] px-6 py-4">
          <DialogTitle>{attachmentPreview?.kind === 'trace' ? 'Playwright Trace Preview' : 'Attachment Preview'}</DialogTitle>
          <DialogDescription>{attachmentPreview?.attachment.name || attachmentPreview?.attachment.source || attachmentPreview?.attachment.id || 'Attachment'}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[88vh] overflow-auto bg-[rgb(var(--app-surface))] p-4">
          {attachmentPreview ? <AttachmentPreviewSurface preview={attachmentPreview} variant="dialog" /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )

  return { clearInlinePreviews, dialogs, inlinePreviews, openAttachmentPreview, toggleInlineAttachmentPreview }
}

export function AttachmentList({
  inlinePreviews,
  launchId,
  onOpenAttachmentPreview,
  onToggleInlineAttachmentPreview,
  projectId,
  result,
}: {
  inlinePreviews: Record<string, AttachmentPreviewState | null>
  launchId: string
  onOpenAttachmentPreview: (attachment: TestAttachment) => Promise<void> | void
  onToggleInlineAttachmentPreview: (attachment: TestAttachment) => Promise<void> | void
  projectId: string
  result: TestResult
}) {
  const attachments = collectAttachments(result.steps ?? [])
  const traceAttachments = attachments.filter((attachment) => isTraceAttachment(attachment))

  if (attachments.length === 0) {
    return <p className="text-sm text-[rgb(var(--app-muted))]">No step attachments.</p>
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/70 px-4 py-3">
        <p className="text-sm font-medium text-[rgb(var(--app-ink))]">Attachments summary</p>
        <p className="mt-1 text-xs text-[rgb(var(--app-muted))]">
          {attachments.length} files extracted from execution steps. {traceAttachments.length > 0 ? `${traceAttachments.length} Playwright trace artifact(s) can be previewed inside the platform.` : 'No Playwright trace artifacts detected.'}
        </p>
      </div>

      {traceAttachments.length > 0 && (
        <DetailSection title="Trace Viewer">
          <div className="space-y-3">
            {traceAttachments.map((attachment) => {
              const inlinePreview = inlinePreviews[attachment.id]
              return (
                <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3" key={attachment.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[rgb(var(--app-ink))]">{attachment.name || attachment.source || `Trace ${attachment.id}`}</p>
                      <p className="text-[11px] text-[rgb(var(--app-muted))]">{attachment.type || 'application/zip'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void onToggleInlineAttachmentPreview(attachment)} size="sm" type="button" variant="outline">
                        {inlinePreview ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        Preview
                      </Button>
                      <Button onClick={() => void onOpenAttachmentPreview(attachment)} size="sm" type="button" variant="outline">
                        Open
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <a download href={attachment.traceAssetUrl || buildAttachmentDownloadUrl(projectId, launchId, attachment.id)}>
                          Download
                        </a>
                      </Button>
                    </div>
                  </div>
                  {attachment.traceTokenExpiresAt && (
                    <p className="text-[11px] text-[rgb(var(--app-muted))]">Viewer tokens refresh on preview open. Last issued token expires at {fmtDate(attachment.traceTokenExpiresAt) ?? attachment.traceTokenExpiresAt}.</p>
                  )}
                  {inlinePreview ? (
                    <div className="rounded-xl border border-blue-200/70 bg-white/80 p-3">
                      <AttachmentPreviewSurface preview={inlinePreview} variant="inline" />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </DetailSection>
      )}

      <DetailSection title="All Files">
        <div className="space-y-2">
          {attachments.map((attachment) => {
            const inlinePreview = inlinePreviews[attachment.id]
            return (
              <div className="space-y-2 rounded-lg border border-[rgb(var(--app-line))] bg-white/80 px-3 py-2" key={attachment.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-[rgb(var(--app-ink))]">{attachment.name}</p>
                    <p className="text-[10px] text-[rgb(var(--app-muted))]">{attachment.type}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {isPreviewableAttachment(attachment) ? (
                      <>
                        <Button onClick={() => void onToggleInlineAttachmentPreview(attachment)} size="sm" type="button" variant="outline">
                          {inlinePreview ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          Preview
                        </Button>
                        <Button onClick={() => void onOpenAttachmentPreview(attachment)} size="sm" type="button" variant="outline">
                          Open
                        </Button>
                      </>
                    ) : null}
                    <Button asChild size="sm" variant="outline">
                      <a download href={buildAttachmentDownloadUrl(projectId, launchId, attachment.id)}>
                        Download
                      </a>
                    </Button>
                  </div>
                </div>
                {inlinePreview ? (
                  <div className="rounded-xl border border-dashed border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/60 p-3">
                    <AttachmentPreviewSurface preview={inlinePreview} variant="inline" />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </DetailSection>
    </div>
  )
}

function ResultDetail({
  launchId,
  onTriggerSingleRerun,
  projectId,
  result,
  rerunBusy,
}: {
  launchId: string
  onTriggerSingleRerun: (result: TestResult) => void
  projectId: string
  result: TestResult
  rerunBusy: boolean
}) {
  const { apiClient } = useRuntime()
  const [frontendExtensions, setFrontendExtensions] = useState<LoadedFrontendExtension[]>([])
  const capabilitiesQuery = useQuery(getCapabilitiesQueryOptions(apiClient))
  const licenseConfigQuery = useQuery(getAiLicenseConfigQueryOptions(apiClient))
  useEffect(() => {
    let active = true
    loadFrontendExtensions().then((extensions) => { if (active) setFrontendExtensions(extensions) }).catch(() => { if (active) setFrontendExtensions([]) })
    return () => { active = false }
  }, [])
  const [requestedTab, setRequestedTab] = useState<DetailTab>('overview')
  const paramEntries = getParamEntries(result)
  const hasStoredProConfig = licenseConfigQuery.data?.mode === 'pro_self_hosted' && licenseConfigQuery.data?.hasStoredLicense === true
  const isProLicensed = Boolean(capabilitiesQuery.data?.licensed) || hasStoredProConfig
  const detailContributions = resultDetailContributions(frontendExtensions)
    .filter((contribution) => isFrontendContributionEntitled(contribution.requiredEntitlement, isProLicensed))
  const contributionIds = new Set(detailContributions.map((contribution) => `extension:${contribution.id}`))
  const tab = requestedTab !== 'overview' && !['attachments', 'history', 'retries', 'steps'].includes(requestedTab) && !contributionIds.has(requestedTab)
    ? 'overview'
    : requestedTab
  const { clearInlinePreviews, dialogs: attachmentPreviewDialogs, inlinePreviews, openAttachmentPreview, toggleInlineAttachmentPreview } = useAttachmentPreviewState(apiClient, projectId, launchId)

  const tabs: Array<{ count?: number; id: DetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'steps', label: 'Steps', count: (result.steps ?? []).length || undefined },
    { id: 'history', label: 'History', count: (result.history ?? []).length || undefined },
    { id: 'retries', label: 'Retries', count: (result.retries ?? []).length || undefined },
    { id: 'attachments', label: 'Attachments', count: result.totalAttachments || undefined },
    ...detailContributions.map((contribution) => ({ id: `extension:${contribution.id}`, label: contribution.label })),
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-[rgb(var(--app-line))] px-4 pb-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={result.status} />
            {result.allureId ? (
              <span className="rounded-full border border-[rgb(var(--app-line))] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--app-muted))]">{result.allureId}</span>
            ) : null}
          </div>
          {isUnstableResult(result) ? (
            <Button disabled={rerunBusy} onClick={() => onTriggerSingleRerun(result)} size="sm" type="button" variant="outline">
              <RotateCcw className={`h-3.5 w-3.5 ${rerunBusy ? 'animate-spin' : ''}`} />
              Rerun
            </Button>
          ) : null}
        </div>
        <h3 className="mt-2 text-base font-semibold leading-snug text-[rgb(var(--app-ink))]">{result.name}</h3>
        <div className="mt-1 flex flex-wrap gap-3 text-xs text-[rgb(var(--app-muted))]">
          {fmtDate(result.startTime) ? <span>{fmtDate(result.startTime)}</span> : null}
          {fmt(result.duration) ? (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {fmt(result.duration)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[rgb(var(--app-line))] px-4 pt-1">
        {tabs.map((item) => (
          <button
            className={`flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-medium transition ${tab === item.id ? 'border-b-2 border-[rgb(var(--app-accent))] text-[rgb(var(--app-accent))]' : 'text-[rgb(var(--app-muted))] hover:text-[rgb(var(--app-ink))]'}`}
            key={item.id}
            onClick={() => {
              clearInlinePreviews()
              setRequestedTab(item.id)
            }}
            type="button"
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="rounded-full bg-[rgb(var(--app-surface))] px-1.5 py-0.5 text-[9px] font-bold text-[rgb(var(--app-muted))]">{item.count}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'overview' && (
          <div className="space-y-4">
            {result.diagnostics?.message ? (
              <div className="rounded-xl border border-red-200 bg-red-50/80 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
                  {result.diagnostics.failedStepName ? `Failed at: ${result.diagnostics.failedStepName}` : 'Failure'}
                </p>
                <p className="mt-2 text-sm leading-6 text-red-900">{result.diagnostics.message}</p>
                {result.diagnostics.stackTrace ? (
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-[rgb(var(--app-shell))] px-3 py-3 text-[10px] leading-4 text-white/90">{result.diagnostics.stackTrace}</pre>
                ) : null}
              </div>
            ) : null}

            {(result.labels ?? []).length > 0 ? (
              <DetailSection title="Labels">
                <div className="flex flex-wrap gap-1.5">
                  {(result.labels ?? []).map((label, index) => (
                    <span className="rounded-full border border-[rgb(var(--app-line))] px-2.5 py-0.5 text-xs text-[rgb(var(--app-muted))]" key={`${label.name}:${label.value}:${index}`}>
                      {label.name}: {String(label.value ?? '')}
                    </span>
                  ))}
                </div>
              </DetailSection>
            ) : null}

            {paramEntries.length > 0 ? (
              <DetailSection title="Parameters">
                <dl className="space-y-1.5">
                  {paramEntries.map((entry) => (
                    <div className="flex items-start justify-between gap-3 text-xs" key={entry.key}>
                      <dt className="text-[rgb(var(--app-muted))]">{entry.key}</dt>
                      <dd className="max-w-[60%] break-all text-right text-[rgb(var(--app-ink))]">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              </DetailSection>
            ) : null}

            <DetailSection title="IDs">
              <dl className="space-y-1.5">
                <div className="flex items-start justify-between gap-3 text-xs">
                  <dt className="text-[rgb(var(--app-muted))]">Result ID</dt>
                  <dd className="max-w-[65%] break-all text-right font-mono text-[rgb(var(--app-ink))]">{result.id}</dd>
                </div>
                {result.uuid ? (
                  <div className="flex items-start justify-between gap-3 text-xs">
                    <dt className="text-[rgb(var(--app-muted))]">UUID</dt>
                    <dd className="max-w-[65%] break-all text-right font-mono text-[rgb(var(--app-ink))]">{result.uuid}</dd>
                  </div>
                ) : null}
                <div className="flex items-start justify-between gap-3 text-xs">
                  <dt className="text-[rgb(var(--app-muted))]">Result anchor</dt>
                  <dd className="max-w-[65%] break-all text-right font-mono text-[rgb(var(--app-ink))]">{buildAttachmentBaseUrl(projectId, launchId, result.id)}</dd>
                </div>
              </dl>
            </DetailSection>
          </div>
        )}

        {tab === 'steps' ? (
          <ExecutionSteps
            inlinePreviews={inlinePreviews}
            launchId={launchId}
            onOpenAttachmentPreview={openAttachmentPreview}
            onToggleInlineAttachmentPreview={toggleInlineAttachmentPreview}
            projectId={projectId}
            steps={result.steps ?? []}
          />
        ) : null}
        {tab === 'history' ? (
          <RunList
            emptyText="No history entries."
            items={(result.history ?? []).map((entry) => ({ ...entry, startTime: entry.startTime ?? '' }))}
            launchId={launchId}
            projectId={projectId}
          />
        ) : null}
        {tab === 'retries' ? (
          <RunList
            emptyText="No retry entries."
            items={(result.retries ?? []).map((entry) => ({ ...entry, startTime: entry.startTime ?? '' }))}
            launchId={launchId}
            projectId={projectId}
          />
        ) : null}
        {tab === 'attachments' ? (
          <AttachmentList
            inlinePreviews={inlinePreviews}
            launchId={launchId}
            onOpenAttachmentPreview={openAttachmentPreview}
            onToggleInlineAttachmentPreview={toggleInlineAttachmentPreview}
            projectId={projectId}
            result={result}
          />
        ) : null}
        {detailContributions.map((contribution) => {
          if (tab !== `extension:${contribution.id}`) return null
          const Component = contribution.component as ComponentType<{ launchId: string; projectId: string; result: TestResult; resultId: string }>
          return <Component key={contribution.id} launchId={launchId} projectId={projectId} result={result} resultId={result.uuid || result.id} />
        })}
      </div>
      {attachmentPreviewDialogs}
    </div>
  )
}

export function LaunchResultsExplorer({
  launchId,
  onSelectResult,
  onTabChange,
  projectId,
  resultsResponse,
  search,
  showViewTabs = true,
}: LaunchResultsExplorerProps) {
  const { apiClient } = useRuntime()
  const [filterText, setFilterText] = useState('')
  const statusFilterKey = search.status ?? '__all__'
  const baseEnabledStatuses = useMemo(() => buildEnabledStatuses(search.status), [search.status])
  const [statusFilterState, setStatusFilterState] = useState(() => ({
    key: statusFilterKey,
    statuses: buildEnabledStatuses(search.status),
  }))
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [longestFirst, setLongestFirst] = useState(false)
  const [selectedRerunResultIdsState, setSelectedRerunResultIds] = useState<string[]>([])
  const [activeRerunJobId, setActiveRerunJobId] = useState<null | string>(null)
  const enabledStatuses = statusFilterState.key === statusFilterKey ? statusFilterState.statuses : baseEnabledStatuses

  const results = resultsResponse.items
  const resultIdSet = useMemo(() => new Set(results.map((result) => result.id)), [results])
  const selectedRerunResultIds = useMemo(
    () => selectedRerunResultIdsState.filter((id) => resultIdSet.has(id)),
    [resultIdSet, selectedRerunResultIdsState],
  )

  const rerunMutation = useMutation({
    mutationFn: async (request: TestRerunActionRequest) =>
      unwrapApiData(
        await apiClient.post<TestRerunJobResponse>(`/api/v1/projects/${encodeProjectId(projectId)}/runs/${encodeURIComponent(launchId)}/rerun`, {
          metadata: { source: 'frontend-launch-results' },
          selectionMode: request.selectionMode,
          selectors: request.selectors,
        }),
      ) as TestRerunJobResponse,
    onSuccess: (job) => {
      setActiveRerunJobId(job.jobId)
      if (job.selectionMode === 'selected') {
        setSelectedRerunResultIds([])
      }
    },
  })

  const rerunJobQuery = useQuery<TestRerunJobResponse>({
    enabled: Boolean(activeRerunJobId),
    queryKey: ['launch-result-rerun-job', projectId, activeRerunJobId],
    queryFn: async () => unwrapApiData(await apiClient.get<unknown>(`/api/v1/projects/${encodeProjectId(projectId)}/reruns/${encodeURIComponent(activeRerunJobId as string)}`)) as TestRerunJobResponse,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && RERUN_TERMINAL_STATUSES.has(status) ? false : 3000
    },
  })

  const statusCounts = useMemo(
    () => ({
      broken: results.filter((result) => result.status === 'broken').length,
      failed: results.filter((result) => result.status === 'failed').length,
      passed: results.filter((result) => result.status === 'passed').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
    }),
    [results],
  )

  const filteredResults = useMemo(() => {
    let base: typeof results
    if (search.tab === 'defects') {
      base = results.filter((result) => isUnstableResult(result) && isResultStatusEnabled(enabledStatuses, result.status))
    } else {
      base = results.filter((result) => isResultStatusEnabled(enabledStatuses, result.status))
    }

    if (errorsOnly) {
      base = base.filter((result) => isUnstableResult(result) || Boolean(result.diagnostics?.message))
    }

    const normalizedQuery = filterText.trim().toLowerCase()
    if (normalizedQuery) {
      base = base.filter((result) =>
        result.name.toLowerCase().includes(normalizedQuery) ||
        (result.allureId ?? '').toLowerCase().includes(normalizedQuery) ||
        (result.historyId ?? '').toLowerCase().includes(normalizedQuery) ||
        (result.diagnostics?.message ?? '').toLowerCase().includes(normalizedQuery),
      )
    }

    return base
  }, [results, enabledStatuses, errorsOnly, filterText, search.tab])

  const visibleResults = useMemo(() => {
    if (!longestFirst) {
      return filteredResults
    }

    return [...filteredResults].sort((left, right) => (right.duration ?? 0) - (left.duration ?? 0))
  }, [filteredResults, longestFirst])

  const visibleDefectGroups = useMemo(() => buildDefectGroups(filteredResults), [filteredResults])

  const timeline = useMemo(() => buildTimelineModel(filteredResults), [filteredResults])
  const [expandedDefectGroupKeys, setExpandedDefectGroupKeys] = useState<Record<string, boolean>>({})
  const selectAllRef = useRef<HTMLInputElement>(null)

  const selectedResult = visibleResults.find((result) => result.id === search.resultId) || results.find((result) => result.id === search.resultId) || visibleResults[0] || null
  const selectedDefectGroup = useMemo(() => {
    if (search.tab !== 'defects' || !selectedResult) return null
    return visibleDefectGroups.find((group) => group.results.some((result) => result.id === selectedResult.id)) ?? null
  }, [search.tab, selectedResult, visibleDefectGroups])

  const rerunSelectedResultIdSet = useMemo(() => new Set(selectedRerunResultIds), [selectedRerunResultIds])
  const allVisibleSelected = search.tab === 'tests' && visibleResults.length > 0 && visibleResults.every((result) => rerunSelectedResultIdSet.has(result.id))
  const someVisibleSelected = search.tab === 'tests' && visibleResults.some((result) => rerunSelectedResultIdSet.has(result.id)) && !allVisibleSelected

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = Boolean(someVisibleSelected)
    }
  }, [someVisibleSelected])

  const selectedRerunResults = useMemo(() => results.filter((result) => rerunSelectedResultIdSet.has(result.id)), [results, rerunSelectedResultIdSet])

  const failedOrBrokenResults = useMemo(() => results.filter((result) => isUnstableResult(result)), [results])

  const selectedRerunSelectors = useMemo(() => buildRerunSelectors(selectedRerunResults), [selectedRerunResults])

  const failedOrBrokenSelectors = useMemo(() => buildRerunSelectors(failedOrBrokenResults), [failedOrBrokenResults])

  const viewTabs: Array<{ id: ViewTab; label: string }> = [
    { id: 'tests', label: 'Tests' },
    { id: 'defects', label: 'Defects' },
    { id: 'timeline', label: 'Timeline' },
  ]

  const toggleRerunSelection = (resultId: string, checked: boolean) => {
    setSelectedRerunResultIds((current) => {
      if (checked) {
        return current.includes(resultId) ? current : [...current, resultId]
      }
      return current.filter((id) => id !== resultId)
    })
  }

  const toggleAllVisibleSelections = () => {
    if (search.tab !== 'tests') return
    setSelectedRerunResultIds((current) => {
      if (allVisibleSelected) {
        return current.filter((id) => !visibleResults.some((result) => result.id === id))
      }

      const next = new Set(current)
      visibleResults.forEach((result) => next.add(result.id))
      return Array.from(next)
    })
  }

  const toggleDefectGroup = (groupKey: string) => {
    setExpandedDefectGroupKeys((current) => ({
      ...current,
      [groupKey]: !(current[groupKey] ?? true),
    }))
  }

  const handleTimelineSelect = (resultId: string) => {
    onSelectResult(resultId)
    onTabChange('tests')
  }

  const triggerRerunRequest = (selectionMode: TestRerunActionRequest['selectionMode'], requestResults: TestResult[]) => {
    const selectors = buildRerunSelectors(requestResults)
    if (selectors.length === 0) return

    rerunMutation.mutate({
      selectionMode,
      selectors,
      sourceResultIds: requestResults.map((result) => result.id),
    })
  }

  const rerunJob = rerunJobQuery.data
  const rerunStatusTone =
    rerunJob?.status === 'completed'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : rerunJob?.status === 'failed'
        ? 'border-red-200 bg-red-50 text-red-800'
        : rerunJob?.status === 'running'
          ? 'border-blue-200 bg-blue-50 text-blue-800'
          : 'border-slate-200 bg-slate-50 text-slate-700'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-[20px] border border-[rgb(var(--app-line))] bg-white/90 px-4 py-2.5 shadow-[0_8px_24px_rgba(22,29,42,0.05)]">
        {showViewTabs ? (
          <>
            <div className="flex gap-1 rounded-full border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/80 p-1">
              {viewTabs.map((tab) => (
                <button
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${search.tab === tab.id ? 'bg-[rgb(var(--app-accent))] text-white' : 'text-[rgb(var(--app-muted))] hover:text-[rgb(var(--app-ink))]'}`}
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-[rgb(var(--app-line))]" />
          </>
        ) : null}

        {search.tab !== 'timeline' &&
          (['failed', 'broken', 'passed', 'skipped'] as const).map((status) => {
            const active = enabledStatuses[status] !== false
            const disabled = search.tab === 'defects' && status !== 'failed' && status !== 'broken'
            return (
              <button
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${disabled ? 'cursor-default border-[rgb(var(--app-line))] text-[rgb(var(--app-muted))] opacity-30' : active ? STATUS_BADGE[status] : 'border-[rgb(var(--app-line))] bg-transparent text-[rgb(var(--app-muted))] opacity-50'}`}
                disabled={disabled}
                key={status}
                onClick={() => {
                  if (disabled) return
                  const currentStatuses = statusFilterState.key === statusFilterKey ? statusFilterState.statuses : baseEnabledStatuses
                  setStatusFilterState({
                    key: statusFilterKey,
                    statuses: {
                      ...currentStatuses,
                      [status]: !currentStatuses[status],
                    },
                  })
                }}
                type="button"
              >
                <StatusDot status={status} />
                {status.charAt(0).toUpperCase() + status.slice(1)}: {statusCounts[status]}
              </button>
            )
          })}

        <div className="h-4 w-px bg-[rgb(var(--app-line))]" />

        <button
          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${errorsOnly ? 'border-red-300 bg-red-50 text-red-700' : 'border-[rgb(var(--app-line))] text-[rgb(var(--app-muted))] hover:text-[rgb(var(--app-ink))]'}`}
          onClick={() => setErrorsOnly((value) => !value)}
          type="button"
        >
          Errors only
        </button>
        <button
          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${longestFirst ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-[rgb(var(--app-line))] text-[rgb(var(--app-muted))] hover:text-[rgb(var(--app-ink))]'}`}
          onClick={() => setLongestFirst((value) => !value)}
          type="button"
        >
          Longest first
        </button>

        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[rgb(var(--app-muted))]" />
          <input
            className="h-7 rounded-full border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))] pl-7 pr-3 text-xs text-[rgb(var(--app-ink))] outline-none transition focus:border-[rgb(var(--app-accent))]"
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Search tests..."
            type="search"
            value={filterText}
          />
        </div>
      </div>

      {rerunMutation.error instanceof Error ? (
        <div className="rounded-[20px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{rerunMutation.error.message}</div>
      ) : null}

      {rerunJob ? (
        <div className={`rounded-[20px] border px-4 py-3 ${rerunStatusTone}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Rerun job {rerunJob.jobId}</p>
              <p className="mt-1 text-xs opacity-80">
                Status: {rerunJob.status}
                {rerunJob.message ? ` Â· ${rerunJob.message}` : ''}
              </p>
              {rerunJob.childRunId ? <p className="mt-1 text-xs opacity-80">Child run: #{rerunJob.childRunId}</p> : null}
            </div>
            {rerunJob.childRunId ? (
              <Button asChild size="sm" variant="outline">
                <Link params={{ launchId: String(rerunJob.childRunId), projectId }} search={{ resultId: undefined, tab: 'overview' }} to="/projects/$projectId/launches/$launchId">
                  Open child run
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={`grid gap-3 ${search.tab === 'timeline' ? '' : 'xl:grid-cols-[2fr_3fr]'}`}>
        <div className="rounded-[24px] border border-[rgb(var(--app-line))] bg-white/90 shadow-[0_14px_36px_rgba(22,29,42,0.06)]">
          <div className="border-b border-[rgb(var(--app-line))] px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-[rgb(var(--app-muted))]">
                {search.tab === 'defects' ? (
                  <>
                    <span className="font-semibold text-[rgb(var(--app-ink))]">{visibleDefectGroups.length}</span> defects from{' '}
                    <span className="font-semibold text-[rgb(var(--app-ink))]">{visibleResults.length}</span> unstable results
                  </>
                ) : search.tab === 'timeline' ? (
                  <>
                    <span className="font-semibold text-[rgb(var(--app-ink))]">{timeline.lanes.length}</span> lanes from{' '}
                    <span className="font-semibold text-[rgb(var(--app-ink))]">{filteredResults.length}</span> results
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-[rgb(var(--app-ink))]">{visibleResults.length}</span> of {results.length} results
                  </>
                )}
              </p>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  disabled={rerunMutation.isPending || selectedRerunSelectors.length === 0}
                  onClick={() => triggerRerunRequest('selected', selectedRerunResults)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${rerunMutation.isPending ? 'animate-spin' : ''}`} />
                  Rerun selected ({selectedRerunSelectors.length})
                </Button>
                <Button
                  disabled={rerunMutation.isPending || failedOrBrokenSelectors.length === 0}
                  onClick={() => triggerRerunRequest('failed_or_broken', failedOrBrokenResults)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${rerunMutation.isPending ? 'animate-spin' : ''}`} />
                  Rerun failed/broken ({failedOrBrokenSelectors.length})
                </Button>
              </div>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {search.tab === 'timeline' ? (
              timeline.lanes.length === 0 ? (
                <p className="px-4 py-6 text-sm text-[rgb(var(--app-muted))]">No timeline data.</p>
              ) : (
                <div className="space-y-3 p-4">
                  <div className="rounded-2xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/45 p-4">
                    <div className="flex flex-wrap items-center gap-4 text-xs text-[rgb(var(--app-muted))]">
                      <span>
                        Start <span className="font-semibold text-[rgb(var(--app-ink))]">{fmtClock(timeline.minStartMs)}</span>
                      </span>
                      <span>
                        End <span className="font-semibold text-[rgb(var(--app-ink))]">{fmtClock(timeline.maxEndMs)}</span>
                      </span>
                      <span>
                        Total <span className="font-semibold text-[rgb(var(--app-ink))]">{fmtTimelineElapsed(timeline.totalDurationMs)}</span>
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-[72px_minmax(0,1fr)] items-end gap-3 border-b border-[rgb(var(--app-line))] pb-3">
                      <div />
                      <div className="relative h-10">
                        {Array.from({ length: 7 }, (_, tickIndex) => {
                          const leftPercent = (tickIndex / 6) * 100
                          const elapsedMs = (timeline.totalDurationMs * tickIndex) / 6
                          const tickMs = timeline.minStartMs + elapsedMs
                          return (
                            <div
                              className="absolute inset-y-0"
                              key={`timeline-tick-${tickIndex}`}
                              style={tickIndex === 6 ? { right: 0 } : { left: `${leftPercent}%` }}
                            >
                              <div className="absolute bottom-0 h-10 border-l border-dashed border-[rgb(var(--app-line))]" />
                              <div className={`absolute top-0 whitespace-nowrap text-[10px] font-semibold text-[rgb(var(--app-ink))] ${tickIndex === 6 ? 'right-0 text-right' : 'left-2'}`}>{fmtTimelineElapsed(elapsedMs)}</div>
                              <div className={`absolute top-4 whitespace-nowrap text-[10px] text-[rgb(var(--app-muted))] ${tickIndex === 6 ? 'right-0 text-right' : 'left-2'}`}>{fmtClock(tickMs)}</div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                  {timeline.lanes.map((lane, laneIndex) => (
                    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3" key={lane.id}>
                      <div className="pt-1 text-xs font-medium text-[rgb(var(--app-muted))]">
                        <span className="block text-[10px] uppercase tracking-[0.16em]">Thread</span>
                        {laneIndex + 1}
                      </div>
                      <div className="relative h-16 overflow-hidden rounded-xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/50">
                        {Array.from({ length: 7 }, (_, tickIndex) => (
                          <div
                            className="absolute inset-y-0 border-l border-dashed border-[rgb(var(--app-line))]/80"
                            key={`${lane.id}-grid-${tickIndex}`}
                            style={tickIndex === 6 ? { right: 0 } : { left: `${(tickIndex / 6) * 100}%` }}
                          />
                        ))}
                        {lane.items.map((entry) => {
                          const isActive = selectedResult?.id === entry.result.id
                          const timelineLeft = `min(${entry.leftPercent}%, calc(100% - 22px))`
                          return (
                            <button
                              className={`absolute top-2 h-12 min-w-0 overflow-hidden rounded-xl border px-2.5 text-left text-[10px] font-medium leading-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md box-border ${isActive ? 'border-[rgb(var(--app-accent))] ring-2 ring-[rgb(var(--app-accent))]/20' : 'border-transparent'}`}
                              key={entry.result.id}
                              onClick={() => handleTimelineSelect(entry.result.id)}
                              style={{
                                backgroundColor: 'rgba(255,255,255,0.9)',
                                left: timelineLeft,
                                maxWidth: `calc(100% - ${timelineLeft})`,
                                width: `max(${entry.widthPercent}%, 22px)`,
                              }}
                              type="button"
                              title={`${entry.result.name} â€¢ ${entry.result.status} â€¢ ${fmt(entry.durationMs) ?? '-'}`}
                            >
                              <div className="flex items-center gap-1">
                                <StatusDot status={entry.result.status} />
                                <span className="truncate text-[rgb(var(--app-ink))]">{entry.result.name}</span>
                              </div>
                              <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[rgb(var(--app-muted))]">
                                <span className="truncate">{fmtTimelineElapsed(entry.startMs - timeline.minStartMs)}</span>
                                <span className="truncate">{fmt(entry.durationMs) ?? '-'}</span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : search.tab === 'defects' ? (
              visibleDefectGroups.length === 0 ? (
                <p className="px-4 py-6 text-sm text-[rgb(var(--app-muted))]">No defects match.</p>
              ) : (
                <div className="divide-y divide-[rgb(var(--app-line))]">
                  {visibleDefectGroups.map((group, index) => {
                    const primaryResult = group.primaryResult
                    const isSelected = selectedDefectGroup?.key === group.key
                    const expanded = expandedDefectGroupKeys[group.key] !== false
                    return (
                      <div
                        className={`px-4 py-3 transition hover:bg-[rgb(var(--app-surface))]/50 ${isSelected ? 'border-l-2 border-[rgb(var(--app-accent))] bg-[rgb(var(--app-accent))]/5' : ''}`}
                        key={group.key}
                      >
                        <button className="flex w-full items-start gap-2 text-left" onClick={() => toggleDefectGroup(group.key)} type="button">
                          <span className="mt-0.5 rounded-full border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--app-muted))]">#{index + 1}</span>
                          <StatusDot status={primaryResult.status} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-medium text-[rgb(var(--app-ink))]">
                                {primaryResult.diagnostics?.failedStepName || primaryResult.diagnostics?.message || primaryResult.name}
                              </span>
                              <span className="shrink-0 rounded-full border border-[rgb(var(--app-line))] px-1.5 py-0.5 text-[9px] font-semibold text-[rgb(var(--app-muted))]">
                                {group.results.length}
                              </span>
                              <span className="shrink-0 text-[10px] text-[rgb(var(--app-muted))]">{expanded ? 'Collapse' : 'Expand'}</span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[rgb(var(--app-muted))]">
                              {primaryResult.diagnostics?.message || primaryResult.name}
                            </p>
                          </div>
                          <span className="shrink-0 text-[10px] text-[rgb(var(--app-muted))]">{fmt(primaryResult.duration) ?? '-'}</span>
                        </button>
                        {expanded ? (
                          <div className="mt-3 space-y-1.5 border-l border-dashed border-[rgb(var(--app-line))] pl-4">
                            {group.results.map((result) => (
                              <button
                                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-[rgb(var(--app-surface))]/50 ${selectedResult?.id === result.id ? 'bg-[rgb(var(--app-accent))]/5' : ''}`}
                                key={result.id}
                                onClick={() => onSelectResult(result.id)}
                                type="button"
                              >
                                <span className="shrink-0 rounded-full border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--app-muted))]">
                                  #{getResultDisplayId(result)}
                                </span>
                                <StatusDot status={result.status} />
                                <span className="min-w-0 flex-1 truncate text-xs text-[rgb(var(--app-ink))]">{result.name}</span>
                                <span className="shrink-0 text-[10px] text-[rgb(var(--app-muted))]">{fmt(result.duration) ?? '-'}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )
            ) : visibleResults.length === 0 ? (
              <p className="px-4 py-6 text-sm text-[rgb(var(--app-muted))]">No results match.</p>
            ) : (
              <div className="divide-y divide-[rgb(var(--app-line))]">
                {search.tab === 'tests' ? (
                  <div className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-[rgb(var(--app-muted))]">
                    <input
                      checked={allVisibleSelected}
                      className="h-4 w-4 rounded border-[rgb(var(--app-line))] text-[rgb(var(--app-accent))]"
                      onChange={() => toggleAllVisibleSelections()}
                      ref={selectAllRef}
                      type="checkbox"
                    />
                    <button className="text-left transition hover:text-[rgb(var(--app-ink))]" onClick={() => toggleAllVisibleSelections()} type="button">
                      {allVisibleSelected ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                ) : null}
                {visibleResults.map((result) => (
                  <div
                    aria-label={`Open result: ${result.name}`}
                    className={`flex cursor-pointer items-center gap-2 px-4 py-2.5 transition hover:bg-[rgb(var(--app-surface))]/50 ${selectedResult?.id === result.id ? 'border-l-2 border-[rgb(var(--app-accent))] bg-[rgb(var(--app-accent))]/5' : ''}`}
                    key={result.id}
                    onClick={() => onSelectResult(result.id)}
                    onKeyDown={(event) => {
                      if (event.currentTarget !== event.target) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelectResult(result.id)
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {search.tab !== 'defects' ? (
                      <input
                        checked={rerunSelectedResultIdSet.has(result.id)}
                        className="h-4 w-4 rounded border-[rgb(var(--app-line))] text-[rgb(var(--app-accent))]"
                        onChange={(event) => toggleRerunSelection(result.id, event.target.checked)}
                        onClick={(event) => event.stopPropagation()}
                        type="checkbox"
                      />
                    ) : null}
                    <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className="shrink-0 rounded-full border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--app-muted))]">
                        #{getResultDisplayId(result)}
                      </span>
                      <StatusDot status={result.status} />
                      <span className="min-w-0 flex-1 truncate text-xs text-[rgb(var(--app-ink))]">{result.name}</span>
                    </div>
                    {result.totalAttachments && result.totalAttachments > 0 ? (
                      <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-[rgb(var(--app-muted))]">
                        <Paperclip className="h-2.5 w-2.5" />
                        {result.totalAttachments}
                      </span>
                    ) : null}
                    <span className="shrink-0 text-[10px] text-[rgb(var(--app-muted))]">{fmt(result.duration) ?? '-'}</span>
                    {search.tab !== 'defects' && isUnstableResult(result) ? (
                      <Button
                        disabled={rerunMutation.isPending}
                        onClick={(event) => {
                          event.stopPropagation()
                          triggerRerunRequest('single', [result])
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Rerun
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {search.tab !== 'timeline' ? (
          <div className="min-h-[400px] overflow-hidden rounded-[24px] border border-[rgb(var(--app-line))] bg-white/90 shadow-[0_14px_36px_rgba(22,29,42,0.06)]">
            {selectedResult ? (
              <ResultDetail
                launchId={launchId}
                onTriggerSingleRerun={(result) => triggerRerunRequest('single', [result])}
                projectId={projectId}
                rerunBusy={rerunMutation.isPending}
                result={selectedResult}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-8 py-12 text-sm text-[rgb(var(--app-muted))]">Select a result to inspect details, steps, and attachments.</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
