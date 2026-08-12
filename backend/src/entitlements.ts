import { createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { productLicenseEnvelopeSchema, type ProductLicensePayload } from '@veriqorn/contracts'

import { HttpError } from './errors'

import { type InstallationIdentitySettings, InstallationIdentityService } from './installation-identity'

export type EntitlementId =
  | 'ai.analysis'
  | 'ai.indexing'
  | 'ai.rag'
  | 'ai.connectors.kibana'
  | 'ai.connectors.sentry'
  | 'ai.connectors.grafana'
  | (string & {})

export type EntitlementAvailability = {
  enabled: boolean
  reason?: 'not_entitled' | 'invalid_license' | 'expired' | 'not_installed'
  limit?: number
}

export type EntitlementSnapshot = {
  status: 'active' | 'not_configured' | 'invalid' | 'expired'
  capabilities: Record<string, EntitlementAvailability>
}

const PRODUCT_LICENSE_KEY = 'veriqornLicense'

const aiFeatureByEntitlement: Record<string, 'analysis' | 'indexing' | 'retrieval' | 'kibanaConnector' | 'sentryConnector' | 'grafanaConnector'> = {
  'ai.analysis': 'analysis',
  'ai.indexing': 'indexing',
  'ai.rag': 'retrieval',
  'ai.connectors.kibana': 'kibanaConnector',
  'ai.connectors.sentry': 'sentryConnector',
  'ai.connectors.grafana': 'grafanaConnector',
}

export class EntitlementService {
  constructor(
    private readonly installationIdentity: InstallationIdentityService,
    private readonly settings: InstallationIdentitySettings,
  ) {}

  async snapshot(): Promise<EntitlementSnapshot> {
    return await this.evaluateProductLicense() ?? { status: 'not_configured', capabilities: {} }
  }

  async has(id: EntitlementId): Promise<boolean> {
    return (await this.snapshot()).capabilities[id]?.enabled === true
  }

  async limit(id: EntitlementId): Promise<number | null> {
    // A missing value means that the current v2 compatibility license has no
    // declared numeric limit for this entitlement.
    return (await this.snapshot()).capabilities[id]?.limit ?? null
  }

  async assert(id: EntitlementId): Promise<void> {
    const capability = (await this.snapshot()).capabilities[id]
    if (capability?.enabled) return
    throw new HttpError(403, 'ENTITLEMENT_REQUIRED', `The '${id}' entitlement is required for this operation.`)
  }

  async activate(licenseInput: unknown): Promise<{ success: boolean; message: string; licenseId?: string }> {
    const raw = this.extractLicenseJson(licenseInput)
    if (!raw) return { success: false, message: 'License payload is empty.' }
    const evaluation = await this.evaluateProductLicenseJson(raw)
    if (!evaluation.valid || !evaluation.payload) return { success: false, message: evaluation.message }
    await this.settings.set(PRODUCT_LICENSE_KEY, raw)
    return { success: true, message: 'License activated successfully.', licenseId: evaluation.payload.licenseId }
  }

  async getActivationRequest(): Promise<{
    version: 2
    product: 'veriqorn'
    installationId: string
    installationPublicKey: string
    installationKeyFingerprint: string
    createdAt: string
  }> {
    const legacy = await this.installationIdentity.get()
    return {
      version: 2,
      product: 'veriqorn',
      installationId: legacy.installationId,
      installationPublicKey: legacy.publicKeyPem,
      installationKeyFingerprint: legacy.fingerprint,
      createdAt: legacy.createdAt,
    }
  }

  async getAiCapabilities() {
    const snapshot = await this.snapshot()
    const raw = this.readLicenseFromFile() ?? await this.settings.get(PRODUCT_LICENSE_KEY)
    const evaluation = raw ? await this.evaluateProductLicenseJson(raw) : undefined
    const enabled = (id: string) => snapshot.capabilities[id]?.enabled === true
    const licensed = snapshot.status === 'active'
    const reason = licensed ? undefined : snapshot.status === 'expired' ? 'License expired.' : 'Enterprise license is not configured.'
    return {
      mode: licensed ? 'pro_self_hosted' : 'oss_stub',
      status: licensed ? 'licensed' : snapshot.status === 'not_configured' ? 'stub' : snapshot.status,
      licensed,
      upgradeUrl: null,
      message: licensed ? 'Veriqorn Enterprise license is active.' : reason,
      features: {
        analysis: { enabled: enabled('ai.analysis'), ...(enabled('ai.analysis') ? {} : { reason }) },
        indexing: { enabled: enabled('ai.indexing'), ...(enabled('ai.indexing') ? {} : { reason }) },
        retrieval: { enabled: enabled('ai.rag'), ...(enabled('ai.rag') ? {} : { reason }) },
        kibanaConnector: { enabled: enabled('ai.connectors.kibana'), ...(enabled('ai.connectors.kibana') ? {} : { reason }) },
        sentryConnector: { enabled: enabled('ai.connectors.sentry'), ...(enabled('ai.connectors.sentry') ? {} : { reason }) },
        grafanaConnector: { enabled: enabled('ai.connectors.grafana'), ...(enabled('ai.connectors.grafana') ? {} : { reason }) },
      },
      license: evaluation?.payload ? {
        licenseId: evaluation.payload.licenseId,
        customer: evaluation.payload.customerName,
        issuedAt: evaluation.payload.issuedAt,
        expiresAt: evaluation.payload.expiresAt,
      } : null,
    }
  }

  private async evaluateProductLicense(): Promise<EntitlementSnapshot | null> {
    const raw = this.readLicenseFromFile() ?? await this.settings.get(PRODUCT_LICENSE_KEY)
    if (!raw?.trim()) return null
    const evaluation = await this.evaluateProductLicenseJson(raw)
    if (!evaluation.payload) {
      return { status: evaluation.status, capabilities: {} }
    }

    const capabilities: Record<string, EntitlementAvailability> = {}
    for (const [id, grant] of Object.entries(evaluation.payload.entitlements)) {
      if (!evaluation.valid) {
        capabilities[id] = { enabled: false, reason: evaluation.status === 'expired' ? 'expired' : 'invalid_license' }
      } else if ('limit' in grant) capabilities[id] = { enabled: true, limit: grant.limit }
      else capabilities[id] = grant.enabled ? { enabled: true } : { enabled: false, reason: 'not_entitled' }
    }
    return { status: evaluation.valid ? 'active' : evaluation.status, capabilities }
  }

  private async evaluateProductLicenseJson(raw: string): Promise<{
    valid: boolean
    status: EntitlementSnapshot['status']
    message: string
    payload?: ProductLicensePayload
  }> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { valid: false, status: 'invalid', message: 'Product license is not valid JSON.' }
    }
    const envelope = productLicenseEnvelopeSchema.safeParse(parsed)
    if (!envelope.success) return { valid: false, status: 'invalid', message: 'Product license format is invalid.' }

    const publicKey = this.getPublicKey(envelope.data.signature.keyId)
    if (!publicKey) return { valid: false, status: 'invalid', message: 'Product license verification key is not available.' }
    const signature = this.decodeBase64Url(envelope.data.signature.value)
    if (!signature || !cryptoVerify(null, Buffer.from(canonicalize(envelope.data.payload), 'utf8'), publicKey, signature)) {
      return { valid: false, status: 'invalid', message: 'Product license signature verification failed.' }
    }

    const now = Date.now()
    if (envelope.data.payload.notBefore && Date.parse(envelope.data.payload.notBefore) > now) {
      return { valid: false, status: 'invalid', message: `Product license is not valid before ${envelope.data.payload.notBefore}.` }
    }
    if (envelope.data.payload.expiresAt && Date.parse(envelope.data.payload.expiresAt) < now) {
      return { valid: false, status: 'expired', message: `Product license expired at ${envelope.data.payload.expiresAt}.`, payload: envelope.data.payload }
    }

    const identity = await this.installationIdentity.get()
    if (envelope.data.payload.installation.id !== identity.installationId
      || envelope.data.payload.installation.publicKeyFingerprint !== identity.fingerprint) {
      return { valid: false, status: 'invalid', message: 'Product license is issued for a different installation.' }
    }
    return { valid: true, status: 'active', message: 'Product license is active.', payload: envelope.data.payload }
  }

  private extractLicenseJson(input: unknown): string | null {
    if (typeof input === 'string') return input.trim() || null
    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>
      if (typeof record.license === 'string') return record.license.trim() || null
      if (record.payload && record.signature) return JSON.stringify(input)
    }
    return null
  }

  private readLicenseFromFile(): string | null {
    const path = process.env.VERIQORN_LICENSE_FILE?.trim()
    if (!path || !existsSync(path)) return null
    try {
      return readFileSync(path, 'utf8').trim() || null
    } catch {
      return null
    }
  }

  private getPublicKey(keyId: string) {
    const keyRingRaw = process.env.VERIQORN_LICENSE_PUBLIC_KEYS?.trim()
    let raw: string | undefined
    if (keyRingRaw) {
      try {
        const keyRing = JSON.parse(keyRingRaw) as Record<string, unknown>
        raw = typeof keyRing[keyId] === 'string' ? keyRing[keyId] : undefined
      } catch {
        return null
      }
    }
    raw ||= process.env.VERIQORN_LICENSE_PUBLIC_KEY?.trim()
    if (!raw) return null
    try {
      return raw.includes('BEGIN PUBLIC KEY')
        ? createPublicKey(raw)
        : createPublicKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'spki' })
    } catch {
      return null
    }
  }

  private decodeBase64Url(value: string): Buffer | null {
    const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    try {
      const decoded = Buffer.from(padded, 'base64')
      return decoded.length > 0 ? decoded : null
    } catch {
      return null
    }
  }
}

/** JSON Canonicalization Scheme-compatible for the JSON values accepted by the v3 schema. */
export const canonicalize = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (!value || typeof value !== 'object') throw new Error('Cannot canonicalize non-JSON value')
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
}
