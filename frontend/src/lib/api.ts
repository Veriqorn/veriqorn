export interface ApiEnvelope<T> {
  data: T
  message?: string
  path?: string
  timestamp?: string
}

export class ApiError extends Error {
  public readonly body: unknown
  public readonly status: number
  public readonly url: string

  public constructor({ body, message, status, url }: { body: unknown; message: string; status: number; url: string }) {
    super(message)
    this.name = 'ApiError'
    this.body = body
    this.status = status
    this.url = url
  }
}

export type ApiClient = ReturnType<typeof createApiClient>

export const isApiError = (value: unknown): value is ApiError => value instanceof ApiError

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const unwrapApiData = <T>(value: T | ApiEnvelope<T>): T => {
  if (isRecord(value) && 'data' in value) {
    return value.data as T
  }

  return value as T
}

const getApiErrorMessage = (body: unknown, fallback: string) => {
  if (!isRecord(body)) {
    return fallback
  }

  if (typeof body.message === 'string' && body.message.trim()) {
    return body.message
  }

  if (isRecord(body.error) && typeof body.error.message === 'string' && body.error.message.trim()) {
    return body.error.message
  }

  return fallback
}

const parseResponse = async (response: Response) => {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()
  return text ? text : null
}

export function createApiClient({ baseUrl }: { baseUrl: string }) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const resolveRequestUrl = (path: string) => path.startsWith('http')
    ? path
    : `${normalizedBaseUrl}${path.startsWith('/') ? path : `/${path}`}`

  const requestRaw = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const isFormData = init.body instanceof FormData
    const headers = new Headers(init.headers)

    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json')
    }

    if (!isFormData && init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const url = resolveRequestUrl(path)

    return fetch(url, {
      ...init,
      credentials: 'include',
      headers,
    })
  }

  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const url = resolveRequestUrl(path)
    const response = await requestRaw(path, init)
    const body = await parseResponse(response)

    if (!response.ok) {
      throw new ApiError({
        body,
        message: getApiErrorMessage(body, response.statusText || 'Request failed.'),
        status: response.status,
        url,
      })
    }

    return body as T
  }

  return {
    baseUrl: normalizedBaseUrl,
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, {
        body:
          body === undefined || body instanceof FormData || typeof body === 'string'
            ? (body as BodyInit | undefined)
            : JSON.stringify(body),
        method: 'POST',
      }),
    put: <T>(path: string, body?: unknown) =>
      request<T>(path, {
        body:
          body === undefined || body instanceof FormData || typeof body === 'string'
            ? (body as BodyInit | undefined)
            : JSON.stringify(body),
        method: 'PUT',
      }),
    request,
    requestRaw,
    upload: <T>(path: string, body: FormData) =>
      request<T>(path, {
        body,
        method: 'POST',
      }),
  }
}
