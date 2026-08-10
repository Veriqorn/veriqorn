import type {
  ExtensionManifest,
  FrontendNavigationContribution,
  FrontendResultDetailContribution,
  FrontendRouteContribution,
  FrontendSettingsContribution,
  VeriqornFrontendExtension,
} from '@veriqorn/extension-sdk'

export type FrontendExtensionManifestEntry = ExtensionManifest & {
  module: string
}

export type FrontendExtensionManifest = {
  schemaVersion: 1
  extensions: FrontendExtensionManifestEntry[]
}

export type LoadedFrontendExtension = VeriqornFrontendExtension & {
  moduleUrl: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isManifestEntry = (value: unknown): value is FrontendExtensionManifestEntry =>
  isRecord(value)
  && typeof value.id === 'string' && value.id.trim().length > 0
  && typeof value.version === 'string' && value.version.trim().length > 0
  && typeof value.module === 'string' && value.module.startsWith('/extensions/')
  && typeof value.sdkApiVersion === 'number'
  && typeof value.requiresCore === 'string'

export const parseFrontendExtensionManifest = (value: unknown): FrontendExtensionManifest => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.extensions)) {
    throw new Error('Invalid frontend extension manifest')
  }
  if (!value.extensions.every(isManifestEntry)) throw new Error('Invalid frontend extension manifest entry')
  const ids = new Set<string>()
  for (const extension of value.extensions) {
    if (ids.has(extension.id)) throw new Error(`Duplicate frontend extension id '${extension.id}'`)
    ids.add(extension.id)
  }
  return { schemaVersion: 1, extensions: value.extensions }
}

const isCompatible = (manifest: FrontendExtensionManifestEntry, extension: VeriqornFrontendExtension): boolean =>
  manifest.id === extension.manifest.id
  && manifest.version === extension.manifest.version
  && manifest.sdkApiVersion === extension.manifest.sdkApiVersion

/** Loads only same-origin modules supplied by the active frontend image. */
export const loadFrontendExtensions = async (
  manifestUrl = '/extensions/manifest.json',
  fetcher: typeof fetch = fetch,
): Promise<LoadedFrontendExtension[]> => {
  const response = await fetcher(manifestUrl)
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`Unable to load frontend extension manifest (${response.status})`)
  const manifest = parseFrontendExtensionManifest(await response.json())
  const loaded: LoadedFrontendExtension[] = []

  for (const entry of manifest.extensions) {
    const moduleUrl = new URL(entry.module, window.location.origin)
    if (moduleUrl.origin !== window.location.origin || !moduleUrl.pathname.startsWith('/extensions/')) {
      throw new Error(`Extension '${entry.id}' is not a same-origin extension module`)
    }
    const module = await import(/* @vite-ignore */ moduleUrl.href) as { default?: VeriqornFrontendExtension; extension?: VeriqornFrontendExtension }
    const extension = module.extension ?? module.default
    if (!extension || !isCompatible(entry, extension)) throw new Error(`Extension '${entry.id}' does not match its manifest`)
    loaded.push({ ...extension, moduleUrl: moduleUrl.href })
  }
  return loaded
}

export const navigationContributions = (extensions: ReadonlyArray<LoadedFrontendExtension>): FrontendNavigationContribution[] =>
  extensions.flatMap((extension) => (extension.navigation ?? []).map((navigation) => ({ extension, navigation })))
    .map(({ extension, navigation }) => {
      if (!navigation.href.startsWith('/extensions/')) {
        throw new Error(`Extension '${extension.manifest.id}' navigation must use the /extensions/ namespace`)
      }
      return navigation
    })
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))

export const settingsContributions = (extensions: ReadonlyArray<LoadedFrontendExtension>): FrontendSettingsContribution[] =>
  extensions.flatMap((extension) => extension.settings ?? []).sort((left, right) => (left.order ?? 0) - (right.order ?? 0))

export const resultDetailContributions = (extensions: ReadonlyArray<LoadedFrontendExtension>): FrontendResultDetailContribution[] =>
  extensions.flatMap((extension) => extension.resultDetails ?? []).sort((left, right) => (left.order ?? 0) - (right.order ?? 0))

/** Shared entitlement rule for extension navigation, settings, and routes. */
export const isFrontendContributionEntitled = (requiredEntitlement: string | undefined, isProLicensed: boolean): boolean =>
  !requiredEntitlement || isProLicensed

export const routeContributions = (extensions: ReadonlyArray<LoadedFrontendExtension>): FrontendRouteContribution[] =>
  extensions.flatMap((extension) => (extension.routes ?? []).map((route) => ({ extension, route })))
    .map(({ extension, route }) => {
      if (!route.path.startsWith('/extensions/')) {
        throw new Error(`Extension '${extension.manifest.id}' route path must use the /extensions/ namespace`)
      }
      return route
    })
