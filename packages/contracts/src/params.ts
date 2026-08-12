import { z } from 'zod'

export const projectIdParamSchema = z.object({
  projectId: z.string().trim().min(1),
})

export const runIdParamSchema = z.object({
  runId: z.string().trim().min(1),
})

export const resultIdParamSchema = z.object({
  resultId: z.string().trim().min(1),
})

export const dashboardIdParamSchema = z.object({
  dashboardId: z.string().trim().min(1),
})

export const userIdParamSchema = z.object({
  userId: z.string().trim().min(1),
})

export const apiKeyIdParamSchema = z.union([
  z.object({
    apiKeyId: z.coerce.number().int().positive(),
  }),
  z
    .object({
      id: z.coerce.number().int().positive(),
    })
    .transform(({ id }) => ({ apiKeyId: id })),
])

export const importJobIdParamSchema = z.object({
  importJobId: z.string().trim().min(1),
})

export const notificationRuleIdParamSchema = z.object({
  notificationRuleId: z.string().trim().min(1),
})

export const notificationDeliveryIdParamSchema = z.object({
  notificationDeliveryId: z.string().trim().min(1),
})

export const repositoryIdParamSchema = z.object({
  repositoryId: z.string().trim().min(1),
})

export const failureAnalysisIdParamSchema = z.object({
  failureAnalysisId: z.string().trim().min(1),
})

export const connectorTypeParamSchema = z.object({
  connectorType: z.string().trim().min(1),
})

export const kbArticleSlugParamSchema = z.object({
  articleSlug: z.string().trim().min(1),
})

export const kbGenerationJobIdParamSchema = z.object({
  kbGenerationJobId: z.string().trim().min(1),
})

export const coverageUnitIdParamSchema = z.object({
  coverageUnitId: z.string().trim().min(1),
})

export const coverageRecommendationIdParamSchema = z.object({
  coverageRecommendationId: z.string().trim().min(1),
})

export const traceTokenParamSchema = z.object({
  traceToken: z.string().trim().min(1),
})

export const loginSearchSchema = z.object({
  redirectTo: z.string().trim().optional(),
})

export const launchDetailsSearchSchema = z.object({
  resultId: z.string().optional(),
  status: z.enum(['broken', 'failed', 'passed', 'skipped']).optional(),
  tab: z.enum(['overview', 'tests', 'defects', 'timeline']).optional(),
})

export const testResultsViewSchema = z.enum(['tests', 'defects', 'timeline'])

export const testResultsSearchSchema = z.object({
  resultId: z.string().trim().optional(),
  tab: testResultsViewSchema.default('tests'),
})

export const settingsSectionSchema = z.enum([
  'general',
  'users',
  'projects',
  'notifications',
  'rerun',
  'api-keys',
  'updates',
  'ai-analysis',
  'auto-indexing',
])

export const settingsSearchSchema = z.object({
  section: settingsSectionSchema.default('general'),
})

export type ProjectIdParam = z.infer<typeof projectIdParamSchema>
export type RunIdParam = z.infer<typeof runIdParamSchema>
export type ResultIdParam = z.infer<typeof resultIdParamSchema>
export type DashboardIdParam = z.infer<typeof dashboardIdParamSchema>
export type UserIdParam = z.infer<typeof userIdParamSchema>
export type ApiKeyIdParam = z.infer<typeof apiKeyIdParamSchema>
export type ImportJobIdParam = z.infer<typeof importJobIdParamSchema>
export type NotificationRuleIdParam = z.infer<typeof notificationRuleIdParamSchema>
export type NotificationDeliveryIdParam = z.infer<typeof notificationDeliveryIdParamSchema>
export type RepositoryIdParam = z.infer<typeof repositoryIdParamSchema>
export type FailureAnalysisIdParam = z.infer<typeof failureAnalysisIdParamSchema>
export type ConnectorTypeParam = z.infer<typeof connectorTypeParamSchema>
export type KbArticleSlugParam = z.infer<typeof kbArticleSlugParamSchema>
export type KbGenerationJobIdParam = z.infer<typeof kbGenerationJobIdParamSchema>
export type CoverageUnitIdParam = z.infer<typeof coverageUnitIdParamSchema>
export type CoverageRecommendationIdParam = z.infer<typeof coverageRecommendationIdParamSchema>
export type TraceTokenParam = z.infer<typeof traceTokenParamSchema>
export type LoginSearch = z.infer<typeof loginSearchSchema>
export type LaunchDetailsSearch = z.infer<typeof launchDetailsSearchSchema>
export type TestResultsView = z.infer<typeof testResultsViewSchema>
export type TestResultsSearch = z.infer<typeof testResultsSearchSchema>
export type SettingsSection = z.infer<typeof settingsSectionSchema>
export type SettingsSearch = z.infer<typeof settingsSearchSchema>
