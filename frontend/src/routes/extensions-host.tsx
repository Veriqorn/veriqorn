import { useQuery } from '@tanstack/react-query'
import { createRoute } from '@tanstack/react-router'
import { useEffect, useState, type ComponentType } from 'react'

import { isFrontendContributionEntitled, loadFrontendExtensions, routeContributions, type LoadedFrontendExtension } from '@/extensions/registry'
import { getAiLicenseConfigQueryOptions, getCapabilitiesQueryOptions } from '@/lib/queries'
import { useRuntime } from '@/providers/runtime-provider'
import { authedRoute } from '@/routes/authed'

export const extensionsHostRoute = createRoute({
  component: ExtensionsHostPage,
  getParentRoute: () => authedRoute,
  path: 'extensions/$',
})

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; extensions: LoadedFrontendExtension[] }

function ExtensionsHostPage() {
  const { _splat: path = '' } = extensionsHostRoute.useParams() as { _splat?: string }
  const { apiClient } = useRuntime()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const capabilitiesQuery = useQuery(getCapabilitiesQueryOptions(apiClient))
  const licenseConfigQuery = useQuery(getAiLicenseConfigQueryOptions(apiClient))

  useEffect(() => {
    let active = true
    loadFrontendExtensions()
      .then((extensions) => { if (active) setState({ status: 'ready', extensions }) })
      .catch((error) => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }) })
    return () => { active = false }
  }, [])

  if (state.status === 'loading') return <div className="p-6 text-sm text-muted-foreground">Loading extension…</div>
  if (state.status === 'error') return <div className="p-6 text-sm text-destructive">Unable to load extension: {state.message}</div>

  const route = routeContributions(state.extensions).find((candidate) => candidate.route.path.replace(/^\/+/, '') === path.replace(/^\/+/, ''))
  if (!route) return <div className="p-6 text-sm text-muted-foreground">Extension page not found.</div>

  const hasStoredProConfig =
    licenseConfigQuery.data?.mode === 'pro_self_hosted' &&
    licenseConfigQuery.data?.hasStoredLicense === true
  const isProLicensed = Boolean(capabilitiesQuery.data?.licensed) || hasStoredProConfig
  if (!isFrontendContributionEntitled(route.route.requiredEntitlement, isProLicensed)) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Enterprise license required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This extension is installed, but its required entitlement is not active for this installation.
        </p>
      </div>
    )
  }

  const Component = route.route.component as ComponentType
  return <Component />
}
