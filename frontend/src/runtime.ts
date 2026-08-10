import { createRouter } from '@tanstack/react-router'

import { createApiClient } from '@/lib/api'
import { env } from '@/lib/env'
import { createAppQueryClient } from '@/lib/queries'
import { createRealtimeClient } from '@/lib/realtime'
import { AuthStore } from '@/providers/auth-provider'
import { type AppRuntime } from '@/providers/runtime-provider'
import { routeTree } from '@/router/route-tree'

const apiClient = createApiClient({ baseUrl: env.apiUrl })
const queryClient = createAppQueryClient()
const authStore = new AuthStore(apiClient)
const realtimeClient = createRealtimeClient({ url: env.apiUrl })

export const runtime: AppRuntime = {
  apiClient,
  authStore,
  queryClient,
  realtimeClient,
}

export const router = createRouter({
  context: {
    apiClient,
    auth: authStore,
    queryClient,
  },
  defaultPreload: 'intent',
  routeTree,
  scrollRestoration: true,
})

export type AppRouter = typeof router

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
