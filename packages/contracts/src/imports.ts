import { z } from 'zod'

import { isoDateTimeSchema, paginationSearchSchema, sortOrderSchema, textSearchSchema } from './http'
import { runSchema } from './runs'

const importRunReferenceSchema = z.union([z.string().trim().min(1), z.number().int().positive()])

const importRunConfigSchema = z.object({
  branch: z.string().trim().optional(),
  commit: z.string().trim().optional(),
  environment: z.string().trim().optional(),
  parentRunId: z.string().trim().min(1).optional(),
  project: z.string().trim().optional(),
  runName: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  testRunId: importRunReferenceSchema.optional(),
})

export const importSourceKindSchema = z.enum(['directory_path', 'uploaded_file', 'uploaded_batch', 'ci_archive'])

export const allureImportSourceKindSchema = importSourceKindSchema

export const importJobStatusSchema = z.enum(['accepted', 'queued', 'running', 'completed', 'failed', 'cancelled'])

export const createAllureImportJobRequestSchema = z.object({
  run: importRunConfigSchema.default({}),
  source: z.discriminatedUnion('kind', [
    z.object({
      directoryPath: z.string().trim().min(1),
      kind: z.literal('directory_path'),
    }),
    z.object({
      fileName: z.string().trim().min(1).optional(),
      kind: z.literal('uploaded_file'),
    }),
    z.object({
      fileNames: z.array(z.string().trim().min(1)).optional(),
      kind: z.literal('uploaded_batch'),
    }),
    z.object({
      kind: z.literal('ci_archive'),
      fileName: z.string().trim().min(1).optional(),
    }),
  ]),
})

export const createAllureImportJobFormSchema = z.object({
  branch: z.string().trim().optional(),
  commit: z.string().trim().optional(),
  environment: z.string().trim().optional(),
  parentRunId: z.string().trim().min(1).optional(),
  project: z.string().trim().optional(),
  runName: z.string().trim().min(1).optional(),
  sourceKind: allureImportSourceKindSchema.optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  testRunId: importRunReferenceSchema.optional(),
})

export const importJobSummarySchema = z.object({
  createdAt: isoDateTimeSchema,
  errorMessage: z.string().nullable().optional(),
  finishedAt: isoDateTimeSchema.nullable().optional(),
  format: z.literal('allure').default('allure'),
  id: z.string().trim().min(1),
  importedResults: z.number().int().nonnegative().optional(),
  parentRunId: z.string().trim().min(1).nullable().optional(),
  projectId: z.string().trim().min(1),
  runId: z.string().trim().min(1).nullable().optional(),
  runName: z.string().trim().min(1).optional(),
  source: createAllureImportJobRequestSchema.shape.source,
  startedAt: isoDateTimeSchema.nullable().optional(),
  status: importJobStatusSchema,
  warningCount: z.number().int().nonnegative().optional(),
})

export const allureImportJobResultSchema = z.object({
  job: z.object({
    merged: z.boolean(),
    sourceKind: allureImportSourceKindSchema,
    status: importJobStatusSchema,
  }),
  message: z.string().trim().min(1),
  testRun: runSchema,
})

export const importsListSearchSchema = paginationSearchSchema.merge(textSearchSchema).extend({
  runId: z.string().trim().min(1).optional(),
  sortBy: z.enum(['createdAt', 'finishedAt', 'status']).default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
  sourceKind: importSourceKindSchema.optional(),
  status: importJobStatusSchema.optional(),
})

export type ImportSourceKind = z.infer<typeof importSourceKindSchema>
export type AllureImportSourceKind = z.infer<typeof allureImportSourceKindSchema>
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>
export type CreateAllureImportJobRequest = z.infer<typeof createAllureImportJobRequestSchema>
export type CreateAllureImportJobForm = z.infer<typeof createAllureImportJobFormSchema>
export type ImportJobSummary = z.infer<typeof importJobSummarySchema>
export type AllureImportJobResult = z.infer<typeof allureImportJobResultSchema>
export type ImportsListSearch = z.infer<typeof importsListSearchSchema>
