import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'

import type { ApiClient } from '@/lib/api'
import type { RealtimeClient } from '@/lib/realtime'
import type { AuthStore } from '@/providers/auth-provider'

export interface AppRuntime {
  apiClient: ApiClient
  authStore: AuthStore
  queryClient: QueryClient
  realtimeClient: RealtimeClient
}

const RuntimeContext = createContext<AppRuntime | null>(null)

export function RuntimeProvider({ children, runtime }: { children: ReactNode; runtime: AppRuntime }) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>
}

export function useRuntime() {
  const runtime = useContext(RuntimeContext)

  if (!runtime) {
    throw new Error('useRuntime must be used within a RuntimeProvider.')
  }

  return runtime
}
