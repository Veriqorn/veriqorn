import type { QueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@/lib/api'
import type { AuthStore } from '@/providers/auth-provider'

export interface AppRouterContext {
  apiClient: ApiClient
  auth: AuthStore
  queryClient: QueryClient
}
