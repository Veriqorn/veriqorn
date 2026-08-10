import { z } from 'zod'

const coerceBooleanSearchValue = (value: unknown) => {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on', 'force'].includes(normalized)) {
      return true
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false
    }
  }

  return value
}

export const booleanSearchParamSchema = z.preprocess(coerceBooleanSearchValue, z.boolean())

export const isoDateTimeSchema = z.string().datetime()

export const trimmedStringSchema = z.string().trim().min(1)

export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative().optional(),
  hasNextPage: z.boolean().optional(),
  hasPreviousPage: z.boolean().optional(),
})

export const sortOrderSchema = z.enum(['asc', 'desc'])

export const paginationSearchSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(25),
})

export const textSearchSchema = z.object({
  search: trimmedStringSchema.optional(),
})

export const dateRangeSearchSchema = z.object({
  dateFrom: isoDateTimeSchema.optional(),
  dateTo: isoDateTimeSchema.optional(),
})

export const includeArchivedSearchSchema = z.object({
  includeArchived: booleanSearchParamSchema.default(false),
})

export const apiMetaSchema = z.record(z.string(), z.unknown())

export const apiSuccessEnvelopeSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.literal(true).optional(),
    data,
    meta: apiMetaSchema.optional(),
    timestamp: isoDateTimeSchema.optional(),
    path: z.string().optional(),
  })

export const apiErrorEnvelopeSchema = z.object({
  success: z.literal(false).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    correlationId: z.string().optional(),
  }),
  timestamp: isoDateTimeSchema.optional(),
  path: z.string().optional(),
})

export const paginatedCollectionSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    meta: paginationMetaSchema,
  })

export const paginatedListSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  })

export const apiPaginatedSuccessEnvelopeSchema = <T extends z.ZodTypeAny>(item: T) =>
  apiSuccessEnvelopeSchema(paginatedCollectionSchema(item))

export type PaginationMeta = z.infer<typeof paginationMetaSchema>
export type SortOrder = z.infer<typeof sortOrderSchema>
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>
export type PaginationSearch = z.infer<typeof paginationSearchSchema>
export type TextSearch = z.infer<typeof textSearchSchema>
export type DateRangeSearch = z.infer<typeof dateRangeSearchSchema>
export type IncludeArchivedSearch = z.infer<typeof includeArchivedSearchSchema>
