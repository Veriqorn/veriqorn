import { randomBytes } from 'node:crypto'

import { afterEach, describe, expect, test } from 'bun:test'

import { InstallationIdentityService } from '../src/installation-identity'

class SettingsStub {
  values = new Map<string, string>()
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null }
  async set(key: string, value: string): Promise<void> { this.values.set(key, value) }
  async delete(key: string): Promise<void> { this.values.delete(key) }
}

const originalKey = process.env.VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY

afterEach(() => {
  if (originalKey === undefined) delete process.env.VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY
  else process.env.VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY = originalKey
})

describe('installation identity storage', () => {
  test('encrypts a newly-created private key and keeps its public identity stable', async () => {
    process.env.VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
    const settings = new SettingsStub()
    const first = await new InstallationIdentityService(settings).get()
    const encrypted = await settings.get('veriqornInstallationPrivateKeyEncrypted')

    expect(encrypted).toStartWith('v1:')
    expect(await settings.get('aiLicenseInstallationPrivateKey')).toBeNull()
    await expect(new InstallationIdentityService(settings).get()).resolves.toMatchObject({
      installationId: first.installationId,
      fingerprint: first.fingerprint,
    })
  })

  test('migrates an existing plaintext identity when encryption is configured', async () => {
    const settings = new SettingsStub()
    const legacy = await new InstallationIdentityService(settings).get()
    process.env.VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64url')

    await expect(new InstallationIdentityService(settings).get()).resolves.toMatchObject({
      installationId: legacy.installationId,
      fingerprint: legacy.fingerprint,
    })
    expect(await settings.get('veriqornInstallationPrivateKeyEncrypted')).toStartWith('v1:')
    expect(await settings.get('aiLicenseInstallationPrivateKey')).toBeNull()
  })
})
