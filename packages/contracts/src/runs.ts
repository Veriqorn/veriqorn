import { z } from 'zod'

import { dateRangeSearchSchema, isoDateTimeSchema, paginatedListSchema, sortOrderSchema } from './http'

export const launchStatusFilterSchema = z.enum(['completed', 'failed', 'running'])

export const runStatsSchema = z.object({
  broken: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  passRate: z.number().nonnegative(),
  passed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
})

export const runSchema = z.object({
  branch: z.string().trim().nullable().optional(),
  endTime: isoDateTimeSchema.nullable().optional(),
  environment: z.string().trim().nullable().optional(),
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1),
  projectId: z.string().trim().nullable().optional(),
  startTime: isoDateTimeSchema.nullable().optional(),
  stats: runStatsSchema.optional(),
  status: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).optional(),
  uuid: z.string().trim().nullable().optional(),
})

export const runsListResponseSchema = paginatedListSchema(runSchema)

export const createRunRequestSchema = z.object({
  branch: z.string().trim().optional(),
  environment: z.string().trim().optional(),
  name: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).optional(),
  uuid: z.string().trim().min(1).optional(),
})

export const launchesListSearchSchema = dateRangeSearchSchema.extend({
  branch: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(100).default(10),
  page: z.coerce.number().int().positive().default(1),
  search: z.string().trim().optional(),
  sortBy: z.enum(['startTime', 'name', 'status']).default('startTime'),
  sortOrder: sortOrderSchema.default('desc'),
  status: launchStatusFilterSchema.optional(),
})

export type LaunchStatusFilter = z.infer<typeof launchStatusFilterSchema>
export type RunStats = z.infer<typeof runStatsSchema>
export type Run = z.infer<typeof runSchema>
export type RunsListResponse = z.infer<typeof runsListResponseSchema>
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>
export type LaunchesListSearch = z.infer<typeof launchesListSearchSchema>
