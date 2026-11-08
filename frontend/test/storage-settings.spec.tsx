import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageSection } from '../src/components/settings/storage-section'
import { ApiError, type ApiClient } from '../src/lib/api'

const settings = {
  activeConnectionId: 'legacy-minio', credentialsEncryptionConfigured: true,
  connections: [
    { id: 'legacy-minio', name: 'Installation MinIO', provider: 'minio', endpoint: 'http://minio:9000', region: 'us-east-1', bucket: null, prefix: '', legacy: true, createdAt: null, lastCheckedAt: null },
    { id: 'aws', name: 'AWS production', provider: 's3', endpoint: 'https://s3.eu-west-1.amazonaws.com', region: 'eu-west-1', bucket: 'evidence', prefix: 'veriqorn', legacy: false, createdAt: null, lastCheckedAt: null },
  ],
}
const settle = () => new Promise(resolve => setTimeout(resolve, 15))

describe('Storage settings', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  })
  afterEach(() => {
    act(() => root.unmount())
    queryClient.clear()
    container.remove()
  })

  const render = async (apiClient: ApiClient, isAdmin = true) => {
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(StorageSection, { apiClient, isAdmin })))
      await settle()
    })
    await act(async () => { await settle() })
  }

  it('hides connection details and does not fetch them for non-admins', async () => {
    const get = vi.fn()
    await render({ get } as unknown as ApiClient, false)
    expect(container.textContent).toContain('Administrator access required')
    expect(container.querySelector('form')).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it('keeps the old connection active when activation fails', async () => {
    const post = vi.fn(async () => { throw new ApiError({ status: 502, url: '', body: {}, message: 'Storage check failed' }) })
    await render({ get: async () => ({ data: settings }), post } as unknown as ApiClient)
    const cards = container.querySelectorAll('[data-testid="storage-connection"]')
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('Active for new uploads')
    const button = Array.from(cards[1].querySelectorAll('button')).find(entry => entry.textContent === 'Activate')!
    await act(async () => { button.click(); await settle() })
    expect(post).toHaveBeenCalledWith('/api/v1/system/storage/connections/aws/activate', {})
    expect(container.textContent).toContain('Storage check failed')
    expect(cards[0].textContent).toContain('Active for new uploads')
    expect(button.disabled).toBe(false)
  })

  it('saves an S3 connection and clears credentials after success', async () => {
    const post = vi.fn(async () => ({}))
    await render({ get: async () => ({ data: settings }), post } as unknown as ApiClient)
    for (const [key, value] of Object.entries({ name: 'New AWS', bucket: 'private-evidence', accessKey: 'access', secretKey: 'secret' })) {
      const input = container.querySelector(`#storage-${key}`) as HTMLInputElement
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await settle()
    })
    expect(post).toHaveBeenCalledWith('/api/v1/system/storage/connections', expect.objectContaining({ provider: 's3', name: 'New AWS', bucket: 'private-evidence', accessKey: 'access', secretKey: 'secret' }))
    expect(post.mock.calls[0][1]).not.toHaveProperty('endpoint')
    expect((container.querySelector('#storage-secretKey') as HTMLInputElement).value).toBe('')
    expect(container.textContent).toContain('Connection saved')
  })
})
