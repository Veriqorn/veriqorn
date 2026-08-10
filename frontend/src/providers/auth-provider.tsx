import { loginRequestSchema, sessionSchema, userSchema } from '@veriqorn/contracts'
import type { ReactNode } from 'react'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'

import type { ApiClient } from '@/lib/api'
import { isApiError, isRecord, unwrapApiData } from '@/lib/api'
import type { User } from '@/types'

type AuthListener = () => void

export interface AuthSnapshot {
  error: Error | null
  initialized: boolean
  status: 'anonymous' | 'authenticated' | 'loading'
  user: User | null
}

const normalizeUser = (value: unknown): User => {
  if (!isRecord(value)) {
    throw new Error('Invalid user payload.')
  }

  const user = userSchema.parse({
    avatar: typeof value.avatar === 'string' ? value.avatar : undefined,
    email: String(value.email ?? ''),
    id: String(value.id ?? ''),
    name: String(value.name ?? 'User'),
    role:
      value.role === 'admin'
        ? 'admin'
        : value.role === 'kb_viewer'
          ? 'kb_viewer'
          : 'user',
  })

  return {
    ...user,
    avatar: user.avatar ?? undefined,
  }
}

export class AuthStore {
  private bootstrapPromise: Promise<AuthSnapshot> | null = null
  private readonly listeners = new Set<AuthListener>()
  private snapshot: AuthSnapshot = {
    error: null,
    initialized: false,
    status: 'loading',
    user: null,
  }

  public constructor(private readonly apiClient: ApiClient) {}

  public getSnapshot = () => this.snapshot

  public subscribe = (listener: AuthListener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public async ensureInitialized() {
    if (this.snapshot.initialized) {
      return this.snapshot
    }

    if (this.bootstrapPromise) {
      return this.bootstrapPromise
    }

    this.bootstrapPromise = this.bootstrap()
    return this.bootstrapPromise
  }

  public async login(identifier: string, secret: string) {
    const credentials = loginRequestSchema.parse({ email: identifier, password: secret })
    const payload = await this.apiClient.post<unknown>('/api/v1/auth/session', credentials)
    const session = sessionSchema.parse(unwrapApiData(payload))
    const user = normalizeUser(session.user)

    this.snapshot = {
      error: null,
      initialized: true,
      status: 'authenticated',
      user,
    }
    this.emit()

    return user
  }

  public async logout() {
    try {
      await this.apiClient.delete('/api/v1/auth/session')
    } catch {
      // Client state should still clear even if the server logout call fails.
    }

    this.snapshot = {
      error: null,
      initialized: true,
      status: 'anonymous',
      user: null,
    }
    this.emit()
  }

  private async bootstrap() {
    this.snapshot = {
      ...this.snapshot,
      error: null,
      status: 'loading',
    }
    this.emit()

    try {
      const payload = await this.apiClient.get<unknown>('/api/v1/auth/session')
      const session = sessionSchema.parse(unwrapApiData(payload))
      const user = normalizeUser(session.user)

      this.snapshot = {
        error: null,
        initialized: true,
        status: 'authenticated',
        user,
      }
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        this.snapshot = {
          error: null,
          initialized: true,
          status: 'anonymous',
          user: null,
        }
      } else {
        this.snapshot = {
          error: error instanceof Error ? error : new Error('Failed to restore session.'),
          initialized: true,
          status: 'anonymous',
          user: null,
        }
      }
    } finally {
      this.bootstrapPromise = null
      this.emit()
    }

    return this.snapshot
  }

  private emit() {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

const AuthContext = createContext<AuthStore | null>(null)

export function AuthProvider({ children, store }: { children: ReactNode; store: AuthStore }) {
  useEffect(() => {
    void store.ensureInitialized()
  }, [store])

  return <AuthContext.Provider value={store}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const store = useContext(AuthContext)

  if (!store) {
    throw new Error('useAuth must be used within an AuthProvider.')
  }

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  return useMemo(
    () => ({
      ...snapshot,
      login: (email: string, password: string) => store.login(email, password),
      logout: () => store.logout(),
      refresh: () => store.ensureInitialized(),
    }),
    [snapshot, store],
  )
}
