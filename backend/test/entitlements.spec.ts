import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'

import { afterEach, describe, expect, test } from 'bun:test'

import { canonicalize, EntitlementService } from '../src/entitlements'
import { InstallationIdentityService } from '../src/installation-identity'
import { createTestApp } from './test-helpers'

class SettingsStub {
  private readonly values = new Map<string, string>()

  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null }
  async set(key: string, value: string): Promise<void> { this.values.set(key, value) }
}

const originalKeyRing = process.env.VERIQORN_LICENSE_PUBLIC_KEYS

afterEach(() => {
  if (originalKeyRing === undefined) delete process.env.VERIQORN_LICENSE_PUBLIC_KEYS
  else process.env.VERIQORN_LICENSE_PUBLIC_KEYS = originalKeyRing
})

describe('product entitlement license v3', () => {
  test('activates a locally signed, installation-bound product license', async () => {
    const issuer = generateKeyPairSync('ed25519')
    process.env.VERIQORN_LICENSE_PUBLIC_KEYS = JSON.stringify({
      'test-key-1': issuer.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    })
    const settings = new SettingsStub()
    const entitlements = new EntitlementService(new InstallationIdentityService(settings), settings)
    const request = await entitlements.getActivationRequest()
    const payload = {
      schemaVersion: 3 as const,
      product: 'veriqorn' as const,
      licenseId: 'lic_v3_test',
      customerId: 'acme',
      customerName: 'Acme Corp',
      issuedAt: '2026-08-09T00:00:00.000Z',
      notBefore: '2026-08-09T00:00:00.000Z',
      expiresAt: '2030-08-09T00:00:00.000Z',
      installation: {
        id: request.installationId,
        publicKeyFingerprint: request.installationKeyFingerprint,
      },
      entitlements: {
        'ai.analysis': { enabled: true },
        'ai.rag': { enabled: false },
        'users.max': { limit: 25 },
      },
    }
    const license = {
      payload,
      signature: {
        algorithm: 'Ed25519' as const,
        keyId: 'test-key-1',
        value: cryptoSign(null, Buffer.from(canonicalize(payload), 'utf8'), issuer.privateKey).toString('base64url'),
      },
    }

    await expect(entitlements.activate(license)).resolves.toMatchObject({ success: true, licenseId: 'lic_v3_test' })
    await expect(entitlements.has('ai.analysis')).resolves.toBe(true)
    await expect(entitlements.has('ai.rag')).resolves.toBe(false)
    await expect(entitlements.limit('users.max')).resolves.toBe(25)

    const replacementPayload = {
      ...payload,
      licenseId: 'lic_v3_replacement',
      entitlements: {
        'ai.analysis': { enabled: false },
        'ai.rag': { enabled: true },
      },
    }
    const replacement = {
      payload: replacementPayload,
      signature: {
        algorithm: 'Ed25519' as const,
        keyId: 'test-key-1',
        value: cryptoSign(null, Buffer.from(canonicalize(replacementPayload), 'utf8'), issuer.privateKey).toString('base64url'),
      },
    }
    await expect(entitlements.activate(replacement)).resolves.toMatchObject({ success: true, licenseId: 'lic_v3_replacement' })
    await expect(entitlements.has('ai.analysis')).resolves.toBe(false)
    await expect(entitlements.has('ai.rag')).resolves.toBe(true)
  })

  test('exposes a sanitized edition snapshot through the Core API', async () => {
    const app = createTestApp({
      services: {
        entitlements: {
          snapshot: async () => ({
            status: 'active' as const,
            capabilities: { 'ai.analysis': { enabled: true } },
          }),
        },
      } as never,
    })
    const response = await app.handle(new Request('http://localhost/api/v1/edition', {
      headers: { authorization: 'Bearer test-token' },
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: { status: 'active', capabilities: { 'ai.analysis': { enabled: true } } },
    })
  })

  test('keeps Core operable while an expired product license denies its entitlement', async () => {
    const issuer = generateKeyPairSync('ed25519')
    process.env.VERIQORN_LICENSE_PUBLIC_KEYS = JSON.stringify({
      expired: issuer.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    })
    const settings = new SettingsStub()
    const entitlements = new EntitlementService(new InstallationIdentityService(settings), settings)
    const installation = await entitlements.getActivationRequest()
    const payload = {
      schemaVersion: 3 as const,
      product: 'veriqorn' as const,
      licenseId: 'expired-license',
      customerId: 'acme',
      customerName: 'Acme Corp',
      issuedAt: '2024-01-01T00:00:00.000Z',
      notBefore: '2024-01-01T00:00:00.000Z',
      expiresAt: '2024-01-02T00:00:00.000Z',
      installation: { id: installation.installationId, publicKeyFingerprint: installation.installationKeyFingerprint },
      entitlements: { 'ai.analysis': { enabled: true } },
    }
    const license = {
      payload,
      signature: {
        algorithm: 'Ed25519' as const,
        keyId: 'expired',
        value: cryptoSign(null, Buffer.from(canonicalize(payload), 'utf8'), issuer.privateKey).toString('base64url'),
      },
    }

    await settings.set('veriqornLicense', JSON.stringify(license))
    await expect(entitlements.snapshot()).resolves.toMatchObject({
      status: 'expired',
      capabilities: { 'ai.analysis': { enabled: false, reason: 'expired' } },
    })
  })
})
