import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import { AuthStore } from '@/providers/auth-provider'

type ApiClientMock = {
  delete: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

const createApiClientMock = (): ApiClientMock => ({
  delete: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
})

const createSessionEnvelope = () => ({
  data: {
    user: {
      email: 'admin@example.com',
      id: '1',
      name: 'Admin',
      role: 'admin',
    },
  },
})

describe('AuthStore', () => {
  it('deduplicates bootstrap and restores an authenticated session', async () => {
    const apiClient = createApiClientMock()
    apiClient.get.mockResolvedValue(createSessionEnvelope())
    const store = new AuthStore(apiClient as never)

    const [first, second] = await Promise.all([store.ensureInitialized(), store.ensureInitialized()])

    expect(apiClient.get).toHaveBeenCalledTimes(1)
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/auth/session')
    expect(first).toEqual(second)
    expect(store.getSnapshot()).toMatchObject({
      error: null,
      initialized: true,
      status: 'authenticated',
      user: {
        email: 'admin@example.com',
        id: '1',
        name: 'Admin',
        role: 'admin',
      },
    })
  })

  it('treats 401 bootstrap errors as anonymous state', async () => {
    const apiClient = createApiClientMock()
    apiClient.get.mockRejectedValue(
      new ApiError({
        body: { error: { code: 'AUTH_REQUIRED' } },
        message: 'Unauthorized',
        status: 401,
        url: 'http://localhost/api/v1/auth/session',
      }),
    )
    const store = new AuthStore(apiClient as never)

    const snapshot = await store.ensureInitialized()

    expect(snapshot).toMatchObject({
      error: null,
      initialized: true,
      status: 'anonymous',
      user: null,
    })
  })

  it('preserves unexpected bootstrap errors for the UI', async () => {
    const apiClient = createApiClientMock()
    apiClient.get.mockRejectedValue(new Error('session service unavailable'))
    const store = new AuthStore(apiClient as never)

    const snapshot = await store.ensureInitialized()

    expect(snapshot.initialized).toBe(true)
    expect(snapshot.status).toBe('anonymous')
    expect(snapshot.user).toBeNull()
    expect(snapshot.error).toBeInstanceOf(Error)
    expect(snapshot.error?.message).toBe('session service unavailable')
  })

  it('logs in and updates the authenticated snapshot', async () => {
    const apiClient = createApiClientMock()
    apiClient.post.mockResolvedValue(createSessionEnvelope())
    const store = new AuthStore(apiClient as never)

    const user = await store.login('admin@example.com', 'secret')

    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/auth/session', {
      email: 'admin@example.com',
      password: 'secret',
    })
    expect(user).toMatchObject({
      email: 'admin@example.com',
      id: '1',
      name: 'Admin',
      role: 'admin',
    })
    expect(store.getSnapshot().status).toBe('authenticated')
  })

  it('clears client auth state even if the logout request fails', async () => {
    const apiClient = createApiClientMock()
    apiClient.post.mockResolvedValue(createSessionEnvelope())
    apiClient.delete.mockRejectedValue(new Error('logout endpoint failed'))
    const store = new AuthStore(apiClient as never)

    await store.login('admin@example.com', 'secret')
    await store.logout()

    expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/auth/session')
    expect(store.getSnapshot()).toMatchObject({
      error: null,
      initialized: true,
      status: 'anonymous',
      user: null,
    })
  })
})
