import { z } from 'zod'

const connectionBase = {
  name: z.string().trim().min(1).max(120),
  region: z.string().trim().regex(/^[a-z0-9-]+$/).max(63),
  bucket: z.string().trim().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/),
  prefix: z.string().trim().max(300).default('').refine(value => !value.split('/').some(part => part === '..' || part === '.') && !value.includes('\\'), 'Invalid object prefix'),
  accessKey: z.string().trim().min(1).max(256),
  secretKey: z.string().min(1).max(4096),
  sessionToken: z.string().max(16384).optional(),
}

export const storageConnectionRequestSchema = z.discriminatedUnion('provider', [
  z.object({ ...connectionBase, provider: z.literal('s3') }).strict(),
  z.object({ ...connectionBase, provider: z.literal('minio'), endpoint: z.string().url().max(2048) }).strict(),
])

export const storageConnectionSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(['minio', 's3']),
  endpoint: z.string(),
  region: z.string(),
  bucket: z.string().nullable(),
  prefix: z.string(),
  legacy: z.boolean(),
  createdAt: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
})

export const storageSettingsSchema = z.object({
  activeConnectionId: z.string().nullable(),
  credentialsEncryptionConfigured: z.boolean(),
  connections: z.array(storageConnectionSummarySchema),
})

export type StorageConnectionRequest = z.infer<typeof storageConnectionRequestSchema>
export type StorageConnectionSummary = z.infer<typeof storageConnectionSummarySchema>
export type StorageSettings = z.infer<typeof storageSettingsSchema>
