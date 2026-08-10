import { z } from 'zod'

import { isoDateTimeSchema } from './http'

export const entitlementIdSchema = z.string().trim().min(1).max(160)

export const entitlementGrantSchema = z.union([
  z.object({ enabled: z.boolean() }).strict(),
  z.object({ limit: z.number().int().nonnegative() }).strict(),
])

export const productLicensePayloadSchema = z.object({
  schemaVersion: z.literal(3),
  product: z.literal('veriqorn'),
  licenseId: z.string().trim().min(1),
  customerId: z.string().trim().min(1),
  customerName: z.string().trim().min(1),
  issuedAt: isoDateTimeSchema,
  notBefore: isoDateTimeSchema.nullable().optional(),
  expiresAt: isoDateTimeSchema.nullable(),
  installation: z.object({
    id: z.string().trim().min(1),
    publicKeyFingerprint: z.string().trim().min(1),
  }).strict(),
  entitlements: z.record(entitlementIdSchema, entitlementGrantSchema),
}).strict()

export const productLicenseSignatureSchema = z.object({
  algorithm: z.literal('Ed25519'),
  keyId: z.string().trim().min(1),
  value: z.string().trim().min(1),
}).strict()

export const productLicenseEnvelopeSchema = z.object({
  payload: productLicensePayloadSchema,
  signature: productLicenseSignatureSchema,
}).strict()

export type EntitlementGrant = z.infer<typeof entitlementGrantSchema>
export type ProductLicensePayload = z.infer<typeof productLicensePayloadSchema>
export type ProductLicenseEnvelope = z.infer<typeof productLicenseEnvelopeSchema>
