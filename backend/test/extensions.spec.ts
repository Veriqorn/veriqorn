import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

import { loadBackendExtensions } from '../src/extensions'
import { getBackendExtensionStatuses, initializeBackendExtensions, stopBackendExtensions } from '../src/extensions'
import { createApp } from '../src/app'
import { createTestConfig, createTestServices } from './test-helpers'

const tmpRoot = join(import.meta.dir, '.tmp-extensions')

const configFor = (manifestPath?: string) => ({
  extensionsManifestPath: manifestPath,
  extensionsRoot: tmpRoot,
  platformVersion: 'dev',
}) as never

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('extension manifest loader', () => {
  test('uses an empty extension set when no manifest is configured', async () => {
    await expect(loadBackendExtensions(configFor())).resolves.toEqual([])
  })

  test('does not compose Enterprise AI or KB routes in Community mode', async () => {
    const config = createTestConfig()
    const services = createTestServices({ config })
    const app = createApp(config, services, [])
    const response = await app.handle(new Request('http://localhost/api/v1/ai-analysis/failures/stored/result-1', {
      headers: { authorization: 'Bearer test-token' },
    }))
    expect(response.status).toBe(404)
    const llmResponse = await app.handle(new Request('http://localhost/api/v1/ai/llm/test-connections', {
      headers: { authorization: 'Bearer test-token' },
    }))
    expect(llmResponse.status).toBe(404)
    const kbResponse = await app.handle(new Request('http://localhost/api/v1/projects/project-1/kb/articles', {
      headers: { authorization: 'Bearer test-token' },
    }))
    expect(kbResponse.status).toBe(404)
  })

  test('loads an explicit compatible first-party descriptor', async () => {
    mkdirSync(tmpRoot, { recursive: true })
    const modulePath = join(tmpRoot, 'sample.mjs')
    const manifestPath = join(tmpRoot, 'extensions.json')
    writeFileSync(modulePath, `export const extension = { manifest: { id: 'sample', version: '1.0.0', sdkApiVersion: 1, requiresCore: '*' } };`)
    writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      extensions: [{ id: 'sample', version: '1.0.0', module: './sample.mjs', sdkApiVersion: 1, requiresCore: '*' }],
    }))

    const extensions = await loadBackendExtensions(configFor(manifestPath))
    expect(extensions).toHaveLength(1)
    expect(extensions[0]?.manifest.id).toBe('sample')
  })

  test('rejects a module that escapes the configured extension root', async () => {
    mkdirSync(tmpRoot, { recursive: true })
    const manifestPath = join(tmpRoot, 'extensions.json')
    writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      extensions: [{ id: 'sample', version: '1.0.0', module: '../outside.mjs', sdkApiVersion: 1, requiresCore: '*' }],
    }))

    await expect(loadBackendExtensions(configFor(manifestPath))).rejects.toThrow('escapes configured extension root')
  })

  test('registers extension services and routes without changing Core route composition', async () => {
    mkdirSync(tmpRoot, { recursive: true })
    const modulePath = join(tmpRoot, 'routes-sample.mjs')
    const manifestPath = join(tmpRoot, 'extensions.json')
    writeFileSync(modulePath, `
      export const extension = {
        manifest: { id: 'sample', version: '1.0.0', sdkApiVersion: 1, requiresCore: '*' },
        registerServices: async () => ({ message: 'extension-ready' }),
        registerRoutes: ({ services }) => (app) => app.get('/extensions/sample/health', () => services.message),
      };
    `)
    writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      extensions: [{ id: 'sample', version: '1.0.0', module: './routes-sample.mjs', sdkApiVersion: 1, requiresCore: '*' }],
    }))

    const config = createTestConfig({ extensionsManifestPath: manifestPath, extensionsRoot: tmpRoot })
    const services = createTestServices({ config })
    const loaded = await loadBackendExtensions(config)
    const initialized = await initializeBackendExtensions(config, services, loaded)
    const app = createApp(config, services, initialized)
    const response = await app.handle(new Request('http://localhost/extensions/sample/health'))
    const body = await response.text()

    if (response.status !== 200) throw new Error(body)
    expect(body).toBe('extension-ready')
  })

  test('runs the reference diagnostics extension from an explicit manifest', async () => {
    const samplesRoot = resolve(import.meta.dir, '../extensions/samples')
    const manifestPath = join(samplesRoot, 'diagnostics-sample.manifest.json')
    const config = createTestConfig({ extensionsManifestPath: manifestPath, extensionsRoot: samplesRoot })
    const services = createTestServices({
      config,
      services: {
        entitlements: {
          has: async () => false,
          assert: async () => undefined,
        },
      } as never,
    })
    const loaded = await loadBackendExtensions(config)
    const initialized = await initializeBackendExtensions(config, services, loaded)
    const app = createApp(config, services, initialized)

    const health = await app.handle(new Request('http://localhost/extensions/diagnostics-sample/health'))
    const protectedAction = await app.handle(new Request('http://localhost/extensions/diagnostics-sample/protected-action', { method: 'POST' }))

    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toMatchObject({
      extension: 'diagnostics-sample',
      entitlementAvailable: false,
      status: 'healthy',
    })
    expect(protectedAction.status).toBe(200)
    expect(services.extensionServices.get('diagnostics-sample', 'getStatus')).toBeFunction()

    const editionExtensions = await app.handle(new Request('http://localhost/api/v1/edition/extensions', {
      headers: { authorization: 'Bearer test-token' },
    }))
    expect(editionExtensions.status).toBe(200)
    await expect(editionExtensions.json()).resolves.toMatchObject({
      data: [{
        id: 'diagnostics-sample',
        entitled: false,
        status: 'blocked',
      }],
    })

    await expect(getBackendExtensionStatuses(initialized)).resolves.toEqual([{
      id: 'diagnostics-sample',
      version: '1.0.0',
      displayName: 'Diagnostics sample',
      requiredEntitlements: ['diagnostics.sample'],
      entitled: false,
      status: 'blocked',
      message: 'The extension is installed but required entitlements are unavailable.',
    }])
  })

  test('unregisters extension services when an extension stop hook fails', async () => {
    mkdirSync(tmpRoot, { recursive: true })
    const modulePath = join(tmpRoot, 'failing-stop.mjs')
    const manifestPath = join(tmpRoot, 'extensions.json')
    writeFileSync(modulePath, `
      export const extension = {
        manifest: { id: 'failing-stop', version: '1.0.0', sdkApiVersion: 1, requiresCore: '*' },
        registerServices: () => ({ value: 'registered' }),
        stop: async () => { throw new Error('expected stop failure'); },
      };
    `)
    writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 1,
      extensions: [{ id: 'failing-stop', version: '1.0.0', module: './failing-stop.mjs', sdkApiVersion: 1, requiresCore: '*' }],
    }))

    const config = createTestConfig({ extensionsManifestPath: manifestPath, extensionsRoot: tmpRoot })
    const services = createTestServices({ config })
    const initialized = await initializeBackendExtensions(config, services, await loadBackendExtensions(config))

    await expect(stopBackendExtensions(initialized)).rejects.toThrow('expected stop failure')
    expect(services.extensionServices.listExtensionIds()).toEqual([])
  })

})
