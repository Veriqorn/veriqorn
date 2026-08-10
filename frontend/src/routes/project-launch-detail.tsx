import { useQuery } from '@tanstack/react-query'
import { createRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Link2 } from 'lucide-react'

import { PageActions } from '@/providers/page-actions-provider'
import {
  getProjectLaunchQueryOptions,
  getProjectLaunchResultsQueryOptions,
} from '@/lib/queries'
import { buildProjectLaunchDetailPath } from '@/lib/project-paths'
import { useRuntime } from '@/providers/runtime-provider'
import { projectLayoutRoute } from '@/routes/project-layout'
import { LaunchResultsExplorer } from '@/routes/project-results-explorer'
import { validateLaunchDetailSearch } from '@/router/search'
import { useToast } from '@/providers/toast-provider'

const launchDetailTabs = ['overview', 'tests', 'defects', 'timeline'] as const
type LaunchTab = (typeof launchDetailTabs)[number]
type ViewTab = 'defects' | 'tests' | 'timeline'

export const projectLaunchDetailRoute = createRoute({
  component: ProjectLaunchDetailPage,
  getParentRoute: () => projectLayoutRoute,
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(
        getProjectLaunchQueryOptions(context.apiClient, params.projectId, params.launchId),
      ),
      context.queryClient.ensureQueryData(
        getProjectLaunchResultsQueryOptions(context.apiClient, params.projectId, params.launchId),
      ),
    ])
  },
  path: 'launches/$launchId',
  validateSearch: validateLaunchDetailSearch,
})

// ─── Pass rate ring ───────────────────────────────────────────────────────────

interface RingStats {
  broken: number
  failed: number
  passed: number
  skipped: number
  total: number
}

function statusToLaunchTab(status: 'broken' | 'failed' | 'passed' | 'skipped'): LaunchTab {
  return status === 'broken' || status === 'failed' ? 'defects' : 'tests'
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180.0
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  }
}

function describeDonutSegment(cx: number, cy: number, innerRadius: number, outerRadius: number, startAngle: number, endAngle: number) {
  const startOuter = polarToCartesian(cx, cy, outerRadius, startAngle)
  const endOuter = polarToCartesian(cx, cy, outerRadius, endAngle)
  const startInner = polarToCartesian(cx, cy, innerRadius, startAngle)
  const endInner = polarToCartesian(cx, cy, innerRadius, endAngle)
  const sweep = endAngle - startAngle

  // An SVG arc whose start and end points coincide renders nothing. Split a
  // 360-degree segment in two so an all-passed (or all-failed) run is visible.
  if (sweep >= 360) {
    const middleAngle = startAngle + 180
    const middleOuter = polarToCartesian(cx, cy, outerRadius, middleAngle)
    const middleInner = polarToCartesian(cx, cy, innerRadius, middleAngle)

    return [
      `M ${startOuter.x} ${startOuter.y}`,
      `A ${outerRadius} ${outerRadius} 0 0 1 ${middleOuter.x} ${middleOuter.y}`,
      `A ${outerRadius} ${outerRadius} 0 0 1 ${endOuter.x} ${endOuter.y}`,
      `L ${endInner.x} ${endInner.y}`,
      `A ${innerRadius} ${innerRadius} 0 0 0 ${middleInner.x} ${middleInner.y}`,
      `A ${innerRadius} ${innerRadius} 0 0 0 ${startInner.x} ${startInner.y}`,
      'Z',
    ].join(' ')
  }

  const largeArcFlag = sweep <= 180 ? '0' : '1'

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${startInner.x} ${startInner.y}`,
    'Z',
  ].join(' ')
}

function PassRateRing({ onStatusClick, stats }: { onStatusClick?: (status: 'broken' | 'failed' | 'passed' | 'skipped') => void; stats: RingStats }) {
  const outerRadius = 56
  const innerRadius = 40
  const cx = 72
  const cy = 72
  const [hoveredStatus, setHoveredStatus] = useState<null | 'broken' | 'failed' | 'passed' | 'skipped'>(null)

  const total = stats.total || 1
  const segments = [
    { color: '#10b981', label: 'passed', value: stats.passed },
    { color: '#ef4444', label: 'failed', value: stats.failed },
    { color: '#f59e0b', label: 'broken', value: stats.broken },
    { color: '#94a3b8', label: 'skipped', value: stats.skipped },
  ]

  let offset = 0
  const arcs = segments.map((seg) => {
    const pct = seg.value / total
    const startAngle = (offset / total) * 360
    const endAngle = startAngle + pct * 360
    offset += seg.value
    return {
      color: seg.color,
      endAngle,
      label: seg.label,
      path: describeDonutSegment(cx, cy, innerRadius, outerRadius, startAngle, endAngle),
      startAngle,
      value: seg.value,
    }
  })

  const passRate = Math.round((stats.passed / total) * 100)

  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0">
        <svg height={144} viewBox="0 0 144 144" width={144}>
          <circle cx={cx} cy={cy} fill="#f1f5f9" r={outerRadius} />
          {arcs.map((arc) => {
            const status = arc.label as 'broken' | 'failed' | 'passed' | 'skipped'

            return (
              <path
                key={`${arc.label}-hit`}
                d={arc.path}
                fill="transparent"
                className="cursor-pointer"
                onClick={() => onStatusClick?.(status)}
                onFocus={() => setHoveredStatus(status)}
                onMouseEnter={() => setHoveredStatus(status)}
                onMouseLeave={() => setHoveredStatus((current) => (current === status ? null : current))}
                role={onStatusClick ? 'button' : undefined}
                tabIndex={onStatusClick ? 0 : -1}
                style={{ pointerEvents: 'all' }}
              />
            )
          })}
          {/* Segments */}
          {arcs.map((arc) => {
            const isActive = hoveredStatus === arc.label
            return (
              <path
                d={arc.path}
                key={arc.label}
                className="pointer-events-none transition-[opacity,transform] duration-200 ease-out"
                fill={arc.color}
                opacity={isActive ? 1 : 0.88}
                style={{ transform: `scale(${isActive ? 1.03 : 1})`, transformOrigin: '50% 50%' }}
              />
            )
          })}
          <circle cx={cx} cy={cy} fill="white" r={innerRadius - 2} />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-[rgb(var(--app-ink))]">{passRate}%</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--app-muted))]">pass rate</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <RingLegendItem color="#10b981" count={stats.passed} label="Passed" onClick={onStatusClick ? () => onStatusClick('passed') : undefined} />
        <RingLegendItem color="#ef4444" count={stats.failed} label="Failed" onClick={onStatusClick ? () => onStatusClick('failed') : undefined} />
        <RingLegendItem color="#f59e0b" count={stats.broken} label="Broken" onClick={onStatusClick ? () => onStatusClick('broken') : undefined} />
        <RingLegendItem color="#94a3b8" count={stats.skipped} label="Skipped" onClick={onStatusClick ? () => onStatusClick('skipped') : undefined} />
        <div className="col-span-2 pt-1">
          <p className="text-[11px] text-[rgb(var(--app-muted))]">
            <span className="font-semibold text-[rgb(var(--app-ink))]">{stats.total}</span> total results
          </p>
        </div>
      </div>
    </div>
  )
}

function RingLegendItem({ color, count, label, onClick }: { color: string; count: number; label: string; onClick?: () => void }) {
  return (
    <button
      className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-[rgb(var(--app-surface))] hover:text-[rgb(var(--app-accent))]"
      onClick={onClick}
      type="button"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs text-[rgb(var(--app-muted))]">{label}</span>
      <span className="ml-auto text-xs font-semibold text-[rgb(var(--app-ink))]">{count}</span>
    </button>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(value: null | string | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

function fmtDuration(start?: null | string, end?: null | string) {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'completed' || status === 'passed'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : status === 'failed'
        ? 'border-red-200 bg-red-50 text-red-700'
        : status === 'running' || status === 'processing'
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-slate-200 bg-slate-50 text-slate-600'
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${cls}`}>
      {status}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ProjectLaunchDetailPage() {
  const navigate = projectLaunchDetailRoute.useNavigate()
  const { apiClient } = useRuntime()
  const { showToast } = useToast()
  const { launchId, projectId } = projectLaunchDetailRoute.useParams()
  const search = projectLaunchDetailRoute.useSearch()

  const launchQuery = useQuery(getProjectLaunchQueryOptions(apiClient, projectId, launchId))
  const resultsQuery = useQuery(getProjectLaunchResultsQueryOptions(apiClient, projectId, launchId))

  const launch = launchQuery.data
  const resultsResponse = resultsQuery.data

  const ringStats = useMemo((): RingStats | null => {
    if (!resultsResponse) return null
    const meta = resultsResponse.meta
    return {
      broken: meta.brokenCount,
      failed: meta.failedCount,
      passed: meta.passedCount,
      skipped: meta.skippedCount,
      total: meta.totalResults,
    }
  }, [resultsResponse])

  const setTab = (tab: LaunchTab) => {
    void navigate({
      params: { launchId, projectId },
      search: { resultId: search.resultId, status: search.status, tab },
      to: '/projects/$projectId/launches/$launchId',
    })
  }

  const focusResult = (resultId: string) => {
    void navigate({
      params: { launchId, projectId },
      search: { resultId, status: search.status, tab: search.tab === 'overview' ? 'tests' : search.tab },
      to: '/projects/$projectId/launches/$launchId',
    })
  }

  const copyLaunchLink = async () => {
    const launchUrl = `${window.location.origin}${buildProjectLaunchDetailPath(projectId, launchId)}`
    try {
      await navigator.clipboard.writeText(launchUrl)
      showToast('Launch link copied to clipboard.', 'success')
    } catch {
      showToast('Could not copy launch link.', 'error')
    }
  }

  const openStatusView = (status: 'broken' | 'failed' | 'passed' | 'skipped') => {
    void navigate({
      params: { launchId, projectId },
      search: {
        resultId: undefined,
        status,
        tab: statusToLaunchTab(status),
      },
      to: '/projects/$projectId/launches/$launchId',
    })
  }

  if (launchQuery.isLoading || resultsQuery.isLoading) {
    return (
      <div className="rounded-[24px] border border-[rgb(var(--app-line))] bg-white/90 px-6 py-8 text-sm text-[rgb(var(--app-muted))]">
        Loading launch details…
      </div>
    )
  }

  if (!launch || !resultsResponse) {
    return (
      <div className="rounded-[24px] border border-red-200 bg-red-50/80 px-6 py-6 text-sm text-red-900">
        Launch data could not be loaded.
      </div>
    )
  }

  return (
    <>
      <PageActions>
        <div className="flex gap-1 rounded-full border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/80 p-1">
          {launchDetailTabs.map((tab) => (
            <button
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${
                search.tab === tab ? 'bg-[rgb(var(--app-accent))] text-white' : 'text-[rgb(var(--app-muted))] hover:text-[rgb(var(--app-ink))]'
              }`}
              key={tab}
              onClick={() => setTab(tab)}
              type="button"
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </PageActions>

      <div className="space-y-4" data-testid="launch-details-header">
      {search.tab === 'overview' ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          {/* Pass rate ring */}
          <section className="rounded-[24px] border border-[rgb(var(--app-line))] bg-white/90 p-5 shadow-[0_14px_36px_rgba(22,29,42,0.06)]">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.24em] text-[rgb(var(--app-muted))]">Results summary</p>
            <div className="mb-5">
              <div className="flex items-start justify-between gap-4">
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--app-line))] bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--app-muted))] transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-accent))]"
                  onClick={() => void copyLaunchLink()}
                  type="button"
                  title="Copy launch link"
                >
                  <Link2 className="h-3 w-3" />
                  Run #{launch.id}
                </button>
                <StatusBadge status={launch.status} />
              </div>
              <h1 className="mt-3 text-xl font-semibold tracking-tight text-[rgb(var(--app-ink))]">{launch.name}</h1>
              <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-[rgb(var(--app-muted))]">
                <span>{fmtDate(launch.startTime)}</span>
                {fmtDuration(launch.startTime, launch.endTime) && <span>Duration: {fmtDuration(launch.startTime, launch.endTime)}</span>}
              </div>
            </div>
            {ringStats ? (
              <PassRateRing onStatusClick={openStatusView} stats={ringStats} />
            ) : (
              <p className="text-sm text-[rgb(var(--app-muted))]">No results data.</p>
            )}
          </section>

          {/* Execution context */}
          <section className="rounded-[24px] border border-[rgb(var(--app-line))] bg-white/90 p-5 shadow-[0_14px_36px_rgba(22,29,42,0.06)]">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.24em] text-[rgb(var(--app-muted))]">Execution context</p>
            <dl className="space-y-3 text-sm">
              <CtxRow label="Status" value={launch.status} />
              <CtxRow label="Branch" value={launch.branch || '—'} />
              <CtxRow label="Environment" value={launch.environment || '—'} />
              <CtxRow label="Tags" value={launch.tags.length > 0 ? launch.tags.join(', ') : '—'} />
              <CtxRow label="Started" value={fmtDate(launch.startTime)} />
              <CtxRow label="Finished" value={fmtDate(launch.endTime)} />
              {fmtDuration(launch.startTime, launch.endTime) && <CtxRow label="Duration" value={fmtDuration(launch.startTime, launch.endTime) ?? '—'} />}
            </dl>
          </section>

          {/* Top unstable */}
          {resultsResponse.items.filter((r) => r.status === 'failed' || r.status === 'broken').length > 0 && (
            <section className="rounded-[24px] border border-[rgb(var(--app-line))] bg-white/90 p-5 shadow-[0_14px_36px_rgba(22,29,42,0.06)] xl:col-span-2">
              <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.24em] text-[rgb(var(--app-muted))]">Failing tests</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {resultsResponse.items
                  .filter((r) => r.status === 'failed' || r.status === 'broken')
                  .slice(0, 6)
                  .map((result) => (
                    <button
                      className="rounded-xl border border-[rgb(var(--app-line))] bg-[rgb(var(--app-surface))]/70 p-3 text-left transition hover:border-[rgb(var(--app-accent))]/50"
                      key={result.id}
                      onClick={() => focusResult(result.id)}
                      type="button"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${result.status === 'failed' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                          {result.status}
                        </span>
                      </div>
                      <p className="mt-2 truncate text-xs font-semibold text-[rgb(var(--app-ink))]">{result.name}</p>
                      {result.diagnostics?.message && (
                        <p className="mt-1 line-clamp-2 text-[10px] leading-5 text-[rgb(var(--app-muted))]">{result.diagnostics.message}</p>
                      )}
                    </button>
                  ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <LaunchResultsExplorer
          launchId={launchId}
          onSelectResult={focusResult}
          onTabChange={(tab: ViewTab) => setTab(tab)}
          projectId={projectId}
          resultsResponse={resultsResponse}
          showViewTabs={false}
          search={{ resultId: search.resultId, status: search.status, tab: search.tab as ViewTab }}
        />
      )}
      </div>
    </>
  )
}

function CtxRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="font-medium text-[rgb(var(--app-muted))]">{label}</dt>
      <dd className="max-w-[65%] break-words text-right text-[rgb(var(--app-ink))]">{value}</dd>
    </div>
  )
}
