import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApiClient, unwrapApiData } from '@/lib/api'

describe('api client helpers', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('unwraps normalized envelopes and raw payloads', () => {
    expect(unwrapApiData({ data: { ok: true } })).toEqual({ ok: true })
    expect(unwrapApiData(['raw'])).toEqual(['raw'])
  })

  it('sends GET requests with credentials included', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: { status: 'ok' } }),
      ok: true,
      text: async () => '',
    }) as typeof fetch
    const apiClient = createApiClient({ baseUrl: 'http://localhost:3001/' })

    await apiClient.get('/healthz')

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/healthz',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
  })

  it('serializes JSON bodies for POST requests', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: { created: true } }),
      ok: true,
      text: async () => '',
    }) as typeof fetch
    const apiClient = createApiClient({ baseUrl: 'http://localhost:3001' })

    await apiClient.post('/api/v1/items', { name: 'migration' })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/items',
      expect.objectContaining({
        body: JSON.stringify({ name: 'migration' }),
        method: 'POST',
      }),
    )
  })

  it('preserves FormData uploads without forcing JSON headers', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: { uploaded: true } }),
      ok: true,
      text: async () => '',
    }) as typeof fetch
    const apiClient = createApiClient({ baseUrl: 'http://localhost:3001' })
    const body = new FormData()
    body.append('file', new Blob(['zip-bytes'], { type: 'application/zip' }), 'results.zip')

    await apiClient.upload('/api/v1/uploads', body)

    const requestInit = vi.mocked(globalThis.fetch).mock.calls[0]?.[1]
    expect(requestInit).toMatchObject({
      body,
      method: 'POST',
    })
    expect(new Headers(requestInit?.headers).get('content-type')).toBeNull()
  })

  it('throws ApiError with parsed body details on non-ok responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: { code: 'BROKEN', message: 'Something broke' } }),
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => '{"error":{"code":"BROKEN","message":"Something broke"}}',
    }) as typeof fetch
    const apiClient = createApiClient({ baseUrl: 'http://localhost:3001' })

    await expect(apiClient.get('/api/v1/fail')).rejects.toMatchObject({
      body: { error: { code: 'BROKEN', message: 'Something broke' } },
      message: 'Something broke',
      name: 'ApiError',
      status: 502,
      url: 'http://localhost:3001/api/v1/fail',
    })
  })
})
