import { z } from 'zod'

import { isoDateTimeSchema, paginationSearchSchema, sortOrderSchema, textSearchSchema } from './http'

export const kbArticleSchema = z.object({
  category: z.string().trim().min(1),
  generatedAt: isoDateTimeSchema,
  id: z.number().int().positive(),
  order: z.number().int().nonnegative(),
  slug: z.string().trim().min(1),
  title: z.string().trim().min(1),
})

export const kbArticleDetailSchema = kbArticleSchema.extend({
  content: z.string(),
  indexVersion: z.string().trim().min(1).nullable(),
  metadata: z.record(z.string(), z.unknown()),
})

export const kbCategorySchema = z.object({
  articleCount: z.number().int().nonnegative(),
  category: z.string().trim().min(1),
})

export const kbGenerationProgressSchema = z.object({
  current: z.number().int().nonnegative(),
  currentTopic: z.string().trim().min(1),
  percent: z.number().min(0).max(100),
  total: z.number().int().nonnegative(),
})

export const kbStatusSchema = z.object({
  articleCount: z.number().int().nonnegative(),
  generationProgress: kbGenerationProgressSchema.nullable(),
  indexVersion: z.string().trim().min(1).nullable(),
  isGenerating: z.boolean(),
  lastGeneratedAt: isoDateTimeSchema.nullable(),
})

export const kbGenerationJobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed'])

export const createKbGenerationJobRequestSchema = z.object({
  regenerateExisting: z.boolean().default(false),
})

export const kbGenerationJobSchema = z.object({
  createdAt: isoDateTimeSchema,
  errorMessage: z.string().nullable().optional(),
  finishedAt: isoDateTimeSchema.nullable().optional(),
  generatedArticles: z.number().int().nonnegative().optional(),
  id: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  startedAt: isoDateTimeSchema.nullable().optional(),
  status: kbGenerationJobStatusSchema,
})

export const kbArticlesListSearchSchema = paginationSearchSchema.merge(textSearchSchema).extend({
  category: z.string().trim().min(1).optional(),
  sortBy: z.enum(['generatedAt', 'order', 'title']).default('order'),
  sortOrder: sortOrderSchema.default('asc'),
})

export type KbArticle = z.infer<typeof kbArticleSchema>
export type KbArticleDetail = z.infer<typeof kbArticleDetailSchema>
export type KbCategory = z.infer<typeof kbCategorySchema>
export type KbGenerationProgress = z.infer<typeof kbGenerationProgressSchema>
export type KbStatus = z.infer<typeof kbStatusSchema>
export type KbGenerationJobStatus = z.infer<typeof kbGenerationJobStatusSchema>
export type CreateKbGenerationJobRequest = z.infer<typeof createKbGenerationJobRequestSchema>
export type KbGenerationJob = z.infer<typeof kbGenerationJobSchema>
export type KbArticlesListSearch = z.infer<typeof kbArticlesListSearchSchema>
