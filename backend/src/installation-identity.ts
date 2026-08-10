import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'

export type InstallationIdentitySettings = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete?(key: string): Promise<void>
}

export type InstallationIdentity = {
  installationId: string
  publicKeyPem: string
  fingerprint: string
  createdAt: string
}

/**
 * Stable installation-bound identity used by every signed product license.
 *
 * The persisted key names intentionally retain their v2 names. This lets an
 * existing self-hosted installation validate old AI licenses and new product
 * licenses against the same identity during the migration window.
 */
export class InstallationIdentityService {
  constructor(private readonly settings: InstallationIdentitySettings) {}

  async get(): Promise<InstallationIdentity> {
    let installationId = (await this.settings.get('aiLicenseInstallationId'))?.trim()
    const encryptedPrivateKey = (await this.settings.get('veriqornInstallationPrivateKeyEncrypted'))?.trim()
    let privateKeyPem = encryptedPrivateKey
      ? this.decrypt(encryptedPrivateKey)
      : (await this.settings.get('aiLicenseInstallationPrivateKey'))?.trim()
    let createdAt = (await this.settings.get('aiLicenseInstallationCreatedAt'))?.trim()
    if (!installationId || !privateKeyPem || !createdAt) {
      const pair = generateKeyPairSync('ed25519')
      installationId = randomUUID()
      privateKeyPem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
      createdAt = new Date().toISOString()
      await this.settings.set('aiLicenseInstallationId', installationId)
      await this.settings.set('aiLicenseInstallationCreatedAt', createdAt)
      await this.storePrivateKey(privateKeyPem)
    } else if (!encryptedPrivateKey && this.encryptionKey()) {
      // Upgrade a legacy v2 installation in place without changing its public
      // identity, so previously issued licenses remain valid.
      await this.storePrivateKey(privateKeyPem)
    }
    const privateKey = createPrivateKey(privateKeyPem)
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Invalid installation key type')
    const publicKey = createPublicKey(privateKey)
    return {
      installationId,
      publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      fingerprint: createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('base64url'),
      createdAt,
    }
  }

  private async storePrivateKey(privateKeyPem: string): Promise<void> {
    const encrypted = this.encrypt(privateKeyPem)
    if (encrypted) {
      await this.settings.set('veriqornInstallationPrivateKeyEncrypted', encrypted)
      await this.settings.delete?.('aiLicenseInstallationPrivateKey')
      return
    }
    // Development-compatible fallback. Production deployment validation must
    // require VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY before public release.
    await this.settings.set('aiLicenseInstallationPrivateKey', privateKeyPem)
  }

  private encryptionKey(): Buffer | null {
    const raw = process.env.VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY?.trim()
    if (!raw) return null
    const key = Buffer.from(raw, 'base64url')
    if (key.length !== 32) throw new Error('VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY must be a 32-byte base64url value')
    return key
  }

  private encrypt(value: string): string | null {
    const key = this.encryptionKey()
    if (!key) return null
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return `v1:${iv.toString('base64url')}:${ciphertext.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`
  }

  private decrypt(value: string): string {
    const [version, ivValue, ciphertextValue, tagValue] = value.split(':')
    if (version !== 'v1' || !ivValue || !ciphertextValue || !tagValue) throw new Error('Installation private key ciphertext is malformed')
    const key = this.encryptionKey()
    if (!key) throw new Error('VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY is required to read the encrypted installation identity')
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'))
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
      return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8')
    } catch {
      throw new Error('Installation private key ciphertext cannot be decrypted')
    }
  }
}
