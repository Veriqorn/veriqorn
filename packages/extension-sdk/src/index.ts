/**
 * Stable extension contracts shared by Veriqorn Core and first-party
 * Enterprise modules. This package deliberately contains no application
 * implementation, database connection, or license issuer material.
 */

export const EXTENSION_SDK_API_VERSION = 1 as const

export type ExtensionHealthStatus = 'healthy' | 'degraded' | 'blocked' | 'failed'

export type ExtensionManifest = {
  id: string
  version: string
  sdkApiVersion: number
  requiresCore: string
  displayName?: string
  requiredEntitlements?: string[]
}

export type ExtensionHealth = {
  status: ExtensionHealthStatus
  message?: string
  details?: Record<string, string | number | boolean | null>
}

export type ExtensionCapability = {
  id: string
  enabled: boolean
  reason?: 'not_entitled' | 'dependency_unavailable' | 'not_installed' | 'incompatible_extension'
  limit?: number
}

export type ExtensionLogger = {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}

export type EntitlementPort = {
  has(id: string): Promise<boolean>
  limit(id: string): Promise<number | null>
  assert(id: string): Promise<void>
}

export type ExtensionSettingsPort = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete?(key: string): Promise<void>
}

/** Legacy first-party settings with an explicit optional project scope. */
export type ExtensionCompatibilitySettingsPort = {
  get(key: string, projectId?: string): Promise<string | null>
  set(key: string, value: string, projectId?: string): Promise<void>
}

/** Opaque database adapter; the SDK deliberately does not expose TypeORM. */
export type ExtensionDatabasePort = {
  getRepository(entity: unknown): unknown
}

/** Minimal HTTP boundary for first-party route contributions. */
export type ExtensionHttpPort = {
  authenticate(request: Request): Promise<{ id: string; role: string; name: string }>
  requireResultContext(request: Request, resultId: string): Promise<{
    projectId: string
    testRunId: number
    user: { id: string; role: string; name: string }
  }>
  ok(request: Request, data: unknown): unknown
  fail(status: number, code: string, message: string): never
}

export type ExtensionCorePorts = {
  database: ExtensionDatabasePort
  http: ExtensionHttpPort
  /**
   * Compatibility settings explicitly exposed to first-party extensions while
   * legacy settings keys are being adopted. New extension settings belong in
   * the namespaced `settings` port above.
   */
  compatibilitySettings: ExtensionCompatibilitySettingsPort
  /** Project identity resolution; Core keeps project authorization/identity ownership. */
  projects: {
    resolveProjectId(projectId?: string): Promise<string>
    authorize(request: Request, projectId: string, requiredRoles?: string[]): Promise<{
      projectId: string
      user: { id: string; role: string; name: string }
    }>
  }
  /** Read-only filesystem boundary for extensions that process approved local sources. */
  workspace: {
    root: string
    localRepositoryRoots: string[]
  }
  /** Declarative outbound policy supplied by Core; extensions never read env directly. */
  network: {
    outboundAllowedHosts: string[]
    /** Validates an extension's outbound HTTP(S) destination against Core policy. */
    assertSafeOutboundUrl(url: string): Promise<string>
  }
}

export type ExtensionRuntimeContext = {
  extension: ExtensionManifest
  coreVersion: string
  entitlements: EntitlementPort
  settings: ExtensionSettingsPort
  core: ExtensionCorePorts
  logger: ExtensionLogger
}

export type ExtensionRouteContext = ExtensionRuntimeContext & {
  /** Services returned by this extension's own registerServices hook. */
  services: Record<string, unknown>
}

/**
 * `unknown` keeps this package independent from Elysia and TypeORM. Core owns
 * the adapters and validates concrete route/entity/migration contributions.
 */
export type VeriqornBackendExtension = {
  manifest: ExtensionManifest
  entities?: unknown[]
  migrations?: unknown[]
  registerServices?(context: ExtensionRuntimeContext): Promise<Record<string, unknown>> | Record<string, unknown>
  registerRoutes?(context: ExtensionRouteContext): unknown
  start?(context: ExtensionRuntimeContext): Promise<void>
  stop?(): Promise<void>
  health?(): Promise<ExtensionHealth>
}

export type ExtensionModule = {
  default?: VeriqornBackendExtension
  extension?: VeriqornBackendExtension
}

export type ExtensionManifestFile = {
  schemaVersion: 1
  extensions: Array<ExtensionManifest & { module: string }>
}

export type FrontendNavigationContribution = {
  id: string
  label: string
  href: string
  requiredEntitlement?: string
  order?: number
}

export type FrontendSettingsContribution = {
  id: string
  title: string
  requiredEntitlement?: string
  order?: number
  /** Opaque React component rendered by the Core Settings slot. */
  component: unknown
}

/** Stable, read-only context passed to a contributed result-detail tab. */
export type FrontendResultDetailContext = {
  projectId: string
  launchId: string
  resultId: string
  result: unknown
}

/** React remains opaque; Core owns tab layout and supplies the context above. */
export type FrontendResultDetailContribution = {
  id: string
  label: string
  requiredEntitlement?: string
  order?: number
  component: unknown
}

/** React is intentionally opaque to keep the SDK framework-light. */
export type FrontendRouteContribution = {
  id: string
  path: string
  requiredEntitlement?: string
  component: unknown
}

export type VeriqornFrontendExtension = {
  manifest: ExtensionManifest
  navigation?: FrontendNavigationContribution[]
  settings?: FrontendSettingsContribution[]
  resultDetails?: FrontendResultDetailContribution[]
  routes?: FrontendRouteContribution[]
}
