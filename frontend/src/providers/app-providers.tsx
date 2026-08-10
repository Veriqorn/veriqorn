import type { ReactNode } from 'react'

import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import type { AppRuntime } from '@/providers/runtime-provider'
import { QueryProvider } from '@/providers/query-provider'
import { AuthProvider } from '@/providers/auth-provider'
import { PageActionsProvider } from '@/providers/page-actions-provider'
import { RealtimeProvider } from '@/providers/realtime-provider'
import { RuntimeProvider } from '@/providers/runtime-provider'
import { SettingsProvider } from '@/providers/settings-provider'
import { ToastProvider } from '@/providers/toast-provider'

export function AppProviders({ children, runtime }: { children: ReactNode; runtime: AppRuntime }) {
  return (
    <RuntimeProvider runtime={runtime}>
      <AppErrorBoundary>
        <QueryProvider client={runtime.queryClient}>
          <AuthProvider store={runtime.authStore}>
            <SettingsProvider apiClient={runtime.apiClient}>
              <ToastProvider>
                <PageActionsProvider>
                  <RealtimeProvider client={runtime.realtimeClient}>{children}</RealtimeProvider>
                </PageActionsProvider>
              </ToastProvider>
            </SettingsProvider>
          </AuthProvider>
        </QueryProvider>
      </AppErrorBoundary>
    </RuntimeProvider>
  )
}
