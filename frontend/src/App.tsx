import { RouterProvider } from '@tanstack/react-router'

import { AppProviders } from '@/providers/app-providers'
import { router, runtime } from '@/runtime'

export function App() {
  return (
    <AppProviders runtime={runtime}>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
