import { z } from 'zod'

export const testAttachmentSchema = z.object({
  id: z.string().trim().min(1),
  isTrace: z.boolean().optional(),
  name: z.string().trim().min(1),
  source: z.string().trim().min(1),
  traceAssetUrl: z.string().trim().optional(),
  traceTokenExpiresAt: z.string().trim().optional(),
  traceViewerUrl: z.string().trim().optional(),
  type: z.string().trim().min(1),
})

export const testResultLabelSchema = z.object({
  name: z.string().trim().min(1),
  value: z.string(),
})

export const testResultDiagnosticsSchema = z.object({
  failedStepName: z.string().trim().optional(),
  hasAttachments: z.boolean().optional(),
  message: z.string().trim().optional(),
  stackTrace: z.string().trim().optional(),
  status: z.string().trim().optional(),
})

export const testStepStatusDetailsSchema = z.object({
  message: z.string().trim().optional(),
  trace: z.string().trim().optional(),
})

export const testResultHistoryItemSchema = z.object({
  duration: z.number().nonnegative().optional(),
  endTime: z.string().trim().optional(),
  id: z.string().trim().min(1),
  startTime: z.string().trim().min(1),
  status: z.string().trim().min(1),
  testRunId: z.string().trim().optional(),
  uuid: z.string().trim().optional(),
})

export const testStepSchema: z.ZodType<{
  attachments: Array<z.infer<typeof testAttachmentSchema>>
  childSteps: Array<any>
  endTime?: string
  id: string
  name: string
  parameters?: unknown
  stage?: string
  startTime?: string
  status?: string
  statusDetails?: z.infer<typeof testStepStatusDetailsSchema>
}> = z.lazy(() =>
  z.object({
    attachments: z.array(testAttachmentSchema),
    childSteps: z.array(testStepSchema),
    endTime: z.string().trim().optional(),
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    parameters: z.unknown().optional(),
    stage: z.string().trim().optional(),
    startTime: z.string().trim().optional(),
    status: z.string().trim().optional(),
    statusDetails: testStepStatusDetailsSchema.optional(),
  }),
)

export const testResultSchema = z.object({
  allureId: z.string().trim().optional(),
  diagnostics: testResultDiagnosticsSchema.optional(),
  duration: z.number().nonnegative(),
  endTime: z.string().trim().optional(),
  history: z.array(testResultHistoryItemSchema),
  historyId: z.string().trim().optional(),
  id: z.string().trim().min(1),
  labels: z.array(testResultLabelSchema),
  name: z.string().trim().min(1),
  parameters: z.unknown().optional(),
  retries: z.array(testResultHistoryItemSchema),
  startTime: z.string().trim().optional(),
  status: z.string().trim().min(1),
  steps: z.array(testStepSchema),
  totalAttachments: z.number().int().nonnegative(),
  uuid: z.string().trim().optional(),
})

export const testResultsMetaSchema = z.object({
  brokenCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  generatedAt: z.string(),
  passedCount: z.number().int().nonnegative(),
  runId: z.string().trim().min(1),
  skippedCount: z.number().int().nonnegative(),
  totalAttachments: z.number().int().nonnegative(),
  totalResults: z.number().int().nonnegative(),
})

export const testResultsResponseSchema = z.object({
  items: z.array(testResultSchema),
  meta: testResultsMetaSchema,
  total: z.number().int().nonnegative(),
})

export type TestAttachment = z.infer<typeof testAttachmentSchema>
export type TestResultLabel = z.infer<typeof testResultLabelSchema>
export type TestResultDiagnostics = z.infer<typeof testResultDiagnosticsSchema>
export type TestResultHistoryItem = z.infer<typeof testResultHistoryItemSchema>
export type TestStepStatusDetails = z.infer<typeof testStepStatusDetailsSchema>
export type TestStep = z.infer<typeof testStepSchema>
export type TestResult = z.infer<typeof testResultSchema>
export type TestResultsMeta = z.infer<typeof testResultsMetaSchema>
export type TestResultsResponse = z.infer<typeof testResultsResponseSchema>
