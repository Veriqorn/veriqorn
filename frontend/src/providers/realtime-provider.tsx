import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

import type { RealtimeClient } from '@/lib/realtime'
import { useAuth } from '@/providers/auth-provider'

export function RealtimeProvider({ children, client }: { children: ReactNode; client: RealtimeClient }) {
  const queryClient = useQueryClient()
  const { status } = useAuth()

  useEffect(() => client.bind(queryClient), [client, queryClient])

  useEffect(() => {
    if (status === 'authenticated') {
      client.connect()
      return () => client.disconnect()
    }

    client.disconnect()
    return undefined
  }, [client, status])

  return <>{children}</>
}
