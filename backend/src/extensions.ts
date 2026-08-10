import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  EXTENSION_SDK_API_VERSION,
  type ExtensionManifest,
  type ExtensionManifestFile,
  type ExtensionModule,
  type ExtensionRouteContext,
  type ExtensionRuntimeContext,
  type VeriqornBackendExtension,
} from '@veriqorn/extension-sdk'

import type { AppConfig } from './config'
import { HttpError } from './errors'
import type { ExtensionServiceRegistry } from './extension-service-registry'
import { ok, readAuthToken } from './http'
import { requireProjectRole, type AppServices } from './services'

export type LoadedBackendExtension = VeriqornBackendExtension & {
  modulePath: string
}

export type InitializedBackendExtension = {
  extension: LoadedBackendExtension
  services: Record<string, unknown>
  context: ExtensionRuntimeContext
  serviceRegistry: ExtensionServiceRegistry
}

export type BackendExtensionStatus = {
  id: string
  version: string
  displayName?: string
  requiredEntitlements: string[]
  entitled: boolean
  status: 'healthy' | 'degraded' | 'blocked' | 'failed'
  message?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const fail = (message: string): never => {
  throw new Error(`Invalid extension manifest: ${message}`)
}

const parseManifest = (value: unknown): ExtensionManifestFile => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.extensions)) {
    return fail('expected schemaVersion=1 and an extensions array')
  }

  const ids = new Set<string>()
  const extensions = value.extensions.map((entry, index) => {
    if (!isRecord(entry)) return fail(`extension at index ${index} is not an object`)
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    const version = typeof entry.version === 'string' ? entry.version.trim() : ''
    const module = typeof entry.module === 'string' ? entry.module.trim() : ''
    const requiresCore = typeof entry.requiresCore === 'string' ? entry.requiresCore.trim() : ''
    const sdkApiVersion = typeof entry.sdkApiVersion === 'number' ? entry.sdkApiVersion : Number.NaN
    if (!id || !version || !module || !requiresCore || !Number.isInteger(sdkApiVersion)) {
      return fail(`extension at index ${index} has missing or invalid required fields`)
    }
    if (ids.has(id)) return fail(`duplicate extension id '${id}'`)
    ids.add(id)
    return {
      id,
      version,
      module,
      requiresCore,
      sdkApiVersion,
      ...(typeof entry.displayName === 'string' && entry.displayName.trim() ? { displayName: entry.displayName.trim() } : {}),
      ...(Array.isArray(entry.requiredEntitlements)
        ? { requiredEntitlements: entry.requiredEntitlements.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) }
        : {}),
    }
  })

  return { schemaVersion: 1, extensions }
}

const isWithinRoot = (root: string, candidate: string): boolean => {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

const resolveModulePath = (entryModule: string, manifestPath: string, extensionRoot: string): string => {
  const candidate = isAbsolute(entryModule)
    ? resolve(entryModule)
    : resolve(dirname(manifestPath), entryModule)
  if (!isWithinRoot(extensionRoot, candidate)) {
    return fail(`module '${entryModule}' escapes configured extension root`)
  }
  if (!existsSync(candidate)) return fail(`module '${entryModule}' does not exist`)
  return candidate
}

const isCompatibleWithCore = (requiresCore: string, coreVersion: string): boolean => {
  // The first SDK deliberately accepts only exact versions, a wildcard, or
  // development builds. Full semver-range evaluation is added with release
  // automation before external Enterprise packages are published.
  return requiresCore === '*' || requiresCore === coreVersion || coreVersion === 'dev'
}

const assertDescriptor = (
  descriptor: VeriqornBackendExtension,
  manifest: ExtensionManifest,
  coreVersion: string,
): void => {
  if (!descriptor || typeof descriptor !== 'object') fail(`module '${manifest.id}' did not export an extension descriptor`)
  if (descriptor.manifest.id !== manifest.id) fail(`module id for '${manifest.id}' does not match manifest entry`)
  if (descriptor.manifest.version !== manifest.version) fail(`module version for '${manifest.id}' does not match manifest entry`)
  if (descriptor.manifest.sdkApiVersion !== EXTENSION_SDK_API_VERSION) {
    fail(`extension '${manifest.id}' requires SDK API ${descriptor.manifest.sdkApiVersion}; Core supports ${EXTENSION_SDK_API_VERSION}`)
  }
  if (manifest.sdkApiVersion !== EXTENSION_SDK_API_VERSION) {
    fail(`manifest for '${manifest.id}' requires SDK API ${manifest.sdkApiVersion}; Core supports ${EXTENSION_SDK_API_VERSION}`)
  }
  if (!isCompatibleWithCore(manifest.requiresCore, coreVersion)) {
    fail(`extension '${manifest.id}' requires Core '${manifest.requiresCore}', current Core is '${coreVersion}'`)
  }
}

export const loadBackendExtensions = async (config: AppConfig): Promise<LoadedBackendExtension[]> => {
  const manifestPath = config.extensionsManifestPath
  if (!manifestPath || !existsSync(manifestPath)) return []
  const extensionRoot = config.extensionsRoot ?? dirname(manifestPath)

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to read extension manifest '${manifestPath}': ${detail}`)
  }
  const manifest = parseManifest(parsed)
  const loaded: LoadedBackendExtension[] = []

  for (const entry of manifest.extensions) {
    const modulePath = resolveModulePath(entry.module, manifestPath, extensionRoot)
    let module: ExtensionModule
    try {
      module = await import(pathToFileURL(modulePath).href) as ExtensionModule
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Unable to load extension '${entry.id}': ${detail}`)
    }
    const descriptor: VeriqornBackendExtension = module.extension ?? module.default ?? fail(`module '${entry.id}' has no 'extension' or default export`)
    assertDescriptor(descriptor, entry, config.platformVersion)
    loaded.push({ ...descriptor, modulePath })
  }

  return loaded
}

const createLogger = (extensionId: string) => ({
  debug: (message: string, fields?: Record<string, unknown>) => console.debug(`[extension:${extensionId}] ${message}`, fields ?? ''),
  info: (message: string, fields?: Record<string, unknown>) => console.info(`[extension:${extensionId}] ${message}`, fields ?? ''),
  warn: (message: string, fields?: Record<string, unknown>) => console.warn(`[extension:${extensionId}] ${message}`, fields ?? ''),
  error: (message: string, fields?: Record<string, unknown>) => console.error(`[extension:${extensionId}] ${message}`, fields ?? ''),
})

const createRuntimeContext = (extension: LoadedBackendExtension, config: AppConfig, services: AppServices): ExtensionRuntimeContext => {
  const prefix = `extensions:${extension.manifest.id}:`
  const authenticate = async (request: Request) => {
    const token = readAuthToken(request)
    if (!token) throw new HttpError(401, 'AUTH_REQUIRED', 'Authentication is required')
    const user = await services.auth.verify(token)
    return { id: user.sub, role: user.role, name: user.name }
  }
  return {
    extension: extension.manifest,
    coreVersion: config.platformVersion,
    entitlements: services.entitlements,
    settings: {
      get: (key) => services.settings.get(`${prefix}${key}`),
      set: (key, value) => services.settings.set(`${prefix}${key}`, value),
    },
    core: {
      database: {
        getRepository: (entity) => services.dataSource.getRepository(entity as never),
      },
      http: {
        authenticate,
        requireResultContext: async (request, resultId) => {
          const user = await authenticate(request)
          const results = services.extensionServices.get<{ getResultContext(resultId: string): Promise<{ projectId: string; testRunId: number } | null> }>('enterprise-ai', 'aiResults')
            ?? services.aiResults
          const context = await results.getResultContext(resultId)
          if (!context) throw new HttpError(404, 'TEST_RESULT_NOT_FOUND', 'Test result not found')
          const projectId = await requireProjectRole(services, { sub: user.id, role: user.role, name: user.name } as never, context.projectId)
          return { ...context, projectId, user }
        },
        ok: (request, data) => ok(request, data),
        fail: (status, code, message) => { throw new HttpError(status, code, message) },
      },
      compatibilitySettings: {
        get: (key, projectId) => services.settings.get(key, projectId),
        set: (key, value, projectId) => services.settings.set(key, value, projectId),
      },
      projects: {
        resolveProjectId: (projectId) => services.projects.resolveProjectId(projectId),
        authorize: async (request, projectId, requiredRoles) => {
          const user = await authenticate(request)
          const resolvedProjectId = await requireProjectRole(
            services,
            { sub: user.id, role: user.role, name: user.name } as never,
            projectId,
            requiredRoles as never,
          )
          return { projectId: resolvedProjectId, user }
        },
      },
      workspace: {
        root: config.workspaceRoot,
        localRepositoryRoots: [...config.localRepositoryRoots],
      },
      network: {
        outboundAllowedHosts: [...config.outboundAllowedHosts],
      },
    },
    logger: createLogger(extension.manifest.id),
  }
}

export const initializeBackendExtensions = async (
  config: AppConfig,
  services: AppServices,
  extensions: ReadonlyArray<LoadedBackendExtension>,
): Promise<InitializedBackendExtension[]> => {
  const initialized: InitializedBackendExtension[] = []
  for (const extension of extensions) {
    const context = createRuntimeContext(extension, config, services)
    const extensionServices = await extension.registerServices?.(context)
    services.extensionServices.register(extension.manifest.id, extensionServices ?? {})
    initialized.push({ extension, services: extensionServices ?? {}, context, serviceRegistry: services.extensionServices })
  }
  return initialized
}

export const registerBackendExtensionRoutes = (extension: InitializedBackendExtension): unknown => {
  if (!extension.extension.registerRoutes) return undefined
  const context: ExtensionRouteContext = { ...extension.context, services: extension.services }
  return extension.extension.registerRoutes(context)
}

/** Safe, implementation-free status intended for the Core edition endpoint. */
export const getBackendExtensionStatuses = async (
  extensions: ReadonlyArray<InitializedBackendExtension>,
): Promise<BackendExtensionStatus[]> => Promise.all(extensions.map(async ({ context, extension }) => {
  const requiredEntitlements = extension.manifest.requiredEntitlements ?? []
  const entitled = (await Promise.all(requiredEntitlements.map((id) => context.entitlements.has(id)))).every(Boolean)
  if (!entitled) {
    return {
      id: extension.manifest.id,
      version: extension.manifest.version,
      ...(extension.manifest.displayName ? { displayName: extension.manifest.displayName } : {}),
      requiredEntitlements,
      entitled: false,
      status: 'blocked',
      message: 'The extension is installed but required entitlements are unavailable.',
    }
  }
  try {
    const health = await extension.health?.()
    return {
      id: extension.manifest.id,
      version: extension.manifest.version,
      ...(extension.manifest.displayName ? { displayName: extension.manifest.displayName } : {}),
      requiredEntitlements,
      entitled: true,
      status: health?.status ?? 'healthy',
      ...(health?.message ? { message: health.message } : {}),
    }
  } catch {
    return {
      id: extension.manifest.id,
      version: extension.manifest.version,
      ...(extension.manifest.displayName ? { displayName: extension.manifest.displayName } : {}),
      requiredEntitlements,
      entitled: true,
      status: 'failed',
      message: 'The extension health check failed.',
    }
  }
}))

export const startBackendExtensions = async (extensions: ReadonlyArray<InitializedBackendExtension>): Promise<void> => {
  for (const extension of extensions) {
    if (extension.extension.start) await extension.extension.start(extension.context)
  }
}

export const stopBackendExtensions = async (extensions: ReadonlyArray<InitializedBackendExtension>): Promise<void> => {
  for (const extension of [...extensions].reverse()) {
    try {
      if (extension.extension.stop) await extension.extension.stop()
    } finally {
      extension.serviceRegistry.unregister(extension.extension.manifest.id)
    }
  }
}
