import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { queryKeys } from '@/lib/queries'
import { createRealtimeClient } from '@/lib/realtime'

class MockWebSocket {
  public static readonly CONNECTING = 0
  public static readonly OPEN = 1
  public static readonly CLOSED = 3
  public static instances: MockWebSocket[] = []

  public onclose: ((event: CloseEvent) => void) | null = null
  public onerror: ((event: Event) => void) | null = null
  public onmessage: ((event: MessageEvent) => void) | null = null
  public onopen: ((event: Event) => void) | null = null
  public readyState = MockWebSocket.CONNECTING

  public constructor(public readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  public close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  public emitClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(new CloseEvent('close'))
  }

  public emitMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  public emitOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }
}

describe('createRealtimeClient', () => {
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    MockWebSocket.instances = []
    vi.useRealTimers()
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
  })

  it('opens a websocket against the normalized target-stack endpoint', () => {
    const client = createRealtimeClient({ url: 'https://api.example.test/platform/' })

    client.connect()

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]?.url).toBe('wss://api.example.test/platform/ws')
  })

  it('invalidates launches, dashboard, run, and results queries for run events', () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined)
    const queryClient = { invalidateQueries }
    const client = createRealtimeClient({ url: 'http://localhost:3001' })
    const unbind = client.bind(queryClient as never)

    client.connect()
    MockWebSocket.instances[0]?.emitOpen()
    MockWebSocket.instances[0]?.emitMessage(
      JSON.stringify({
        data: {
          id: 42,
          projectId: 'demo-project',
        },
        event: 'testRunUpdated',
      }),
    )

    expect(invalidateQueries).toHaveBeenCalledTimes(4)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projectLaunches('demo-project'),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projectDashboard('demo-project'),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projectLaunch('demo-project', '42'),
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projectLaunchResults('demo-project', '42'),
    })

    unbind()
  })

  it('ignores malformed and unsupported websocket frames', () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined)
    const client = createRealtimeClient({ url: 'http://localhost:3001' })
    client.bind({ invalidateQueries } as never)

    client.connect()
    MockWebSocket.instances[0]?.emitMessage('not-json')
    MockWebSocket.instances[0]?.emitMessage(JSON.stringify({ data: {}, event: 'unknownEvent' }))

    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('reconnects after an unexpected socket close', () => {
    vi.useFakeTimers()

    const client = createRealtimeClient({ url: 'http://localhost:3001' })
    client.connect()
    MockWebSocket.instances[0]?.emitClose()

    expect(MockWebSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(1_000)

    expect(MockWebSocket.instances).toHaveLength(2)
    expect(MockWebSocket.instances[1]?.url).toBe('ws://localhost:3001/ws')
  })

  it('disconnects cleanly and cancels pending reconnects', () => {
    vi.useFakeTimers()

    const client = createRealtimeClient({ url: 'http://localhost:3001' })
    client.connect()
    MockWebSocket.instances[0]?.emitClose()
    client.disconnect()

    vi.advanceTimersByTime(1_000)

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.CLOSED)
  })
})
