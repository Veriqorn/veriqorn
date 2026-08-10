import { z } from 'zod'

import { userSchema } from './auth'
import { isoDateTimeSchema, paginationSearchSchema, sortOrderSchema } from './http'

export const meProfileSchema = userSchema

export const updateMeProfileRequestSchema = z.object({
  name: z.string().trim().min(1),
})

export const changeMePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12).max(128).refine(
    (password) => [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length >= 3,
    'Password must contain at least three character classes',
  ),
})

export const apiKeySchema = z.object({
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.nullable(),
  id: z.number().int().positive(),
  keyPrefix: z.string(),
  lastUsedAt: isoDateTimeSchema.nullable(),
  name: z.string(),
})

export const createApiKeyRequestSchema = z.object({
  expiresAt: z.string().datetime().optional(),
  name: z.string().trim().min(1),
})

export const createdApiKeySchema = apiKeySchema.extend({
  key: z.string().min(1),
})

export const meApiKeysListSearchSchema = paginationSearchSchema.extend({
  sortBy: z.enum(['createdAt', 'expiresAt', 'lastUsedAt', 'name']).default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
})

export type MeProfile = z.infer<typeof meProfileSchema>
export type UpdateMeProfileRequest = z.infer<typeof updateMeProfileRequestSchema>
export type ChangeMePasswordRequest = z.infer<typeof changeMePasswordRequestSchema>
export type ApiKey = z.infer<typeof apiKeySchema>
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>
export type MeApiKeysListSearch = z.infer<typeof meApiKeysListSearchSchema>
