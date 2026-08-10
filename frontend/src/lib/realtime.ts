import type { QueryClient } from '@tanstack/react-query'

import { queryKeys } from '@/lib/queries'

interface RunEventPayload {
  id?: number | string
  projectId?: number | string
  testRun?: {
    id?: number | string
    projectId?: number | string
  }
}

type RunEventName =
  | 'newTestResult'
  | 'testRunDeleted'
  | 'testRunFinished'
  | 'testRunStarted'
  | 'testRunUpdated'

type RunEventHandler = (payload: RunEventPayload) => void

export interface RealtimeClient {
  bind: (queryClient: QueryClient) => () => void
  connect: () => void
  disconnect: () => void
}

const RUN_EVENTS: readonly RunEventName[] = [
  'newTestResult',
  'testRunDeleted',
  'testRunFinished',
  'testRunStarted',
  'testRunUpdated',
]

const extractRunContext = (payload: RunEventPayload) => ({
  projectId: payload.projectId ?? payload.testRun?.projectId,
  runId: payload.id ?? payload.testRun?.id,
})

const toWebSocketUrl = (apiUrl: string): string => {
  try {
    const parsed = new URL(apiUrl)
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
    parsed.pathname = parsed.pathname.replace(/\/$/, '') + '/ws'
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return apiUrl
  }
}

const INITIAL_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_DELAY_MS = 30_000

export const createRealtimeClient = ({ url }: { url: string }): RealtimeClient => {
  const wsUrl = toWebSocketUrl(url)
  const listeners = new Map<RunEventName, Set<RunEventHandler>>()
  for (const event of RUN_EVENTS) listeners.set(event, new Set())

  let socket: WebSocket | null = null
  let shouldConnect = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = INITIAL_RECONNECT_DELAY_MS

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const scheduleReconnect = () => {
    if (!shouldConnect || reconnectTimer !== null) return
    const delay = reconnectDelay
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      openSocket()
    }, delay)
  }

  const dispatch = (event: RunEventName, payload: RunEventPayload) => {
    const handlers = listeners.get(event)
    if (!handlers) return
    for (const handler of handlers) {
      try {
        handler(payload)
      } catch (error) {
        console.error('frontend realtime handler error', error)
      }
    }
  }

  const handleMessage = (raw: string) => {
    let parsed: { event?: unknown; data?: unknown }
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const name = typeof parsed.event === 'string' ? (parsed.event as RunEventName) : null
    if (!name || !listeners.has(name)) return
    const data = (parsed.data ?? {}) as RunEventPayload
    dispatch(name, data)
  }

  const openSocket = () => {
    if (!shouldConnect) return
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch (error) {
      console.error('frontend realtime connection error', error)
      scheduleReconnect()
      return
    }
    socket = ws

    ws.onopen = () => {
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS
    }

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') handleMessage(event.data)
    }

    ws.onerror = () => {
      // onclose will handle reconnect scheduling; errors alone don't close the socket on all browsers
    }

    ws.onclose = () => {
      socket = null
      if (shouldConnect) scheduleReconnect()
    }
  }

  return {
    bind(queryClient) {
      const invalidateFromPayload: RunEventHandler = (payload) => {
        const { projectId, runId } = extractRunContext(payload)
        const normalizedProjectId = projectId ? String(projectId) : null
        const normalizedRunId = runId ? String(runId) : null

        if (normalizedProjectId) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.projectLaunches(normalizedProjectId) })
          void queryClient.invalidateQueries({ queryKey: queryKeys.projectDashboard(normalizedProjectId) })
        }

        if (normalizedProjectId && normalizedRunId) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.projectLaunch(normalizedProjectId, normalizedRunId),
          })
          void queryClient.invalidateQueries({
            queryKey: queryKeys.projectLaunchResults(normalizedProjectId, normalizedRunId),
          })
        }
      }

      for (const event of RUN_EVENTS) listeners.get(event)?.add(invalidateFromPayload)

      return () => {
        for (const event of RUN_EVENTS) listeners.get(event)?.delete(invalidateFromPayload)
      }
    },
    connect() {
      if (shouldConnect) return
      shouldConnect = true
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS
      openSocket()
    },
    disconnect() {
      shouldConnect = false
      clearReconnectTimer()
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS
      if (socket) {
        try {
          socket.close()
        } catch {
          // ignore close errors
        }
        socket = null
      }
    },
  }
}
