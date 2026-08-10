import { z } from 'zod'

import { isoDateTimeSchema, paginationSearchSchema, sortOrderSchema } from './http'

export const aiConnectorTypeSchema = z.enum(['repository', 'kibana', 'logs', 'trace', 'history'])

export const repositorySourceTypeSchema = z.enum(['local', 'network', 'github', 'gitlab', 'bitbucket', 'azure-devops'])

export const aiAnalysisEditionModeSchema = z.enum(['oss_stub', 'pro_self_hosted'])

export const aiAnalysisStatusSchema = z.enum(['stub', 'licensed', 'invalid', 'expired'])

export const aiFeatureAvailabilitySchema = z.object({
  enabled: z.boolean(),
  reason: z.string().optional(),
})

export const aiCapabilitiesFeaturesSchema = z.object({
  analysis: aiFeatureAvailabilitySchema,
  grafanaConnector: aiFeatureAvailabilitySchema,
  indexing: aiFeatureAvailabilitySchema,
  kibanaConnector: aiFeatureAvailabilitySchema,
  retrieval: aiFeatureAvailabilitySchema,
  sentryConnector: aiFeatureAvailabilitySchema,
})

export const aiLicenseSummarySchema = z.object({
  customer: z.string().trim().min(1),
  expiresAt: isoDateTimeSchema.nullable(),
  issuedAt: isoDateTimeSchema,
  licenseId: z.string().trim().min(1),
})

export const aiCapabilitiesSchema = z.object({
  features: aiCapabilitiesFeaturesSchema,
  license: aiLicenseSummarySchema.nullable(),
  licensed: z.boolean(),
  message: z.string(),
  mode: aiAnalysisEditionModeSchema,
  status: aiAnalysisStatusSchema,
  upgradeUrl: z.string().url().nullable(),
})

export const aiRepositoryContextSchema = z.object({
  branch: z.string().trim().min(1).optional(),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  sourceType: repositorySourceTypeSchema.optional(),
  subfolder: z.string().trim().min(1).optional(),
  url: z.string().url(),
})

export const aiRepositoryIndexChangeDetectionModeSchema = z.enum(['fingerprint', 'git-aware'])

export const aiIndexSummaryProviderSchema = z.enum(['deterministic', 'model-assisted'])

export const aiRepositoryIndexRequestSchema = z.object({
  changeDetectionMode: aiRepositoryIndexChangeDetectionModeSchema.optional(),
  chunkOverlapChars: z.number().int().nonnegative().optional(),
  chunkSizeChars: z.number().int().positive().optional(),
  incremental: z.boolean().optional(),
  maxFileSizeBytes: z.number().int().positive().optional(),
  repositoryIds: z.array(z.string().trim().min(1)).optional(),
  summaryProvider: aiIndexSummaryProviderSchema.optional(),
})

export const aiIndexJobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled'])

export const aiRepositoryIndexResultSchema = z.object({
  changedFiles: z.number().int().nonnegative().optional(),
  chunkCount: z.number().int().nonnegative(),
  deletedFiles: z.number().int().nonnegative().optional(),
  embeddingCacheHits: z.number().int().nonnegative().optional(),
  errors: z.array(z.string()),
  indexedFiles: z.number().int().nonnegative(),
  repositoryId: z.string().trim().min(1),
  repositoryName: z.string().trim().min(1),
  scannedFiles: z.number().int().nonnegative().optional(),
  skippedFiles: z.number().int().nonnegative(),
  sourcePath: z.string().trim().min(1).optional(),
  status: z.enum(['indexed', 'skipped']),
  unchangedFiles: z.number().int().nonnegative().optional(),
})

export const aiRepositoryIndexingStatsSchema = z.object({
  changedFiles: z.number().int().nonnegative(),
  deletedFiles: z.number().int().nonnegative(),
  embeddingCacheHits: z.number().int().nonnegative(),
  scannedFiles: z.number().int().nonnegative(),
  summaryCacheHits: z.number().int().nonnegative().optional(),
  unchangedFiles: z.number().int().nonnegative(),
})

export const aiRepositoryIndexResponseSchema = z.object({
  catalogKey: z.string().trim().min(1),
  generatedAt: isoDateTimeSchema,
  indexingStats: aiRepositoryIndexingStatsSchema.optional(),
  repositories: z.array(aiRepositoryIndexResultSchema),
  status: z.enum(['ready', 'partial', 'empty']),
  totalChunks: z.number().int().nonnegative(),
  totalIndexedFiles: z.number().int().nonnegative(),
  totalSkippedFiles: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
})

export const aiIndexJobSchema = z.object({
  createdAt: isoDateTimeSchema,
  errorMessage: z.string().nullable().optional(),
  finishedAt: isoDateTimeSchema.nullable().optional(),
  id: z.string().trim().min(1),
  request: aiRepositoryIndexRequestSchema,
  result: aiRepositoryIndexResponseSchema.nullable().optional(),
  startedAt: isoDateTimeSchema.nullable().optional(),
  status: aiIndexJobStatusSchema,
})

export const aiRepositoryIndexChunkMetaSchema = z.object({
  charCount: z.number().int().nonnegative(),
  chunkId: z.string().trim().min(1).optional(),
  chunkIndex: z.number().int().nonnegative(),
  filePath: z.string().trim().min(1),
  language: z.string().trim().min(1).optional(),
  pathTokens: z.array(z.string()).optional(),
  repositoryId: z.string().trim().min(1),
  repositoryName: z.string().trim().min(1),
  sha1: z.string().trim().min(1),
  summary: z.string().optional(),
  symbolHints: z.array(z.string()).optional(),
})

export const aiRepositoryIndexCatalogSchema = z.object({
  chunks: z.array(aiRepositoryIndexChunkMetaSchema),
  config: z.object({
    changeDetectionMode: aiRepositoryIndexChangeDetectionModeSchema.optional(),
    chunkOverlapChars: z.number().int().nonnegative(),
    chunkSizeChars: z.number().int().positive(),
    fileExtensions: z.array(z.string()),
    ignoredDirectories: z.array(z.string()),
    incremental: z.boolean().optional(),
    maxFileSizeBytes: z.number().int().positive(),
    repositoryIds: z.array(z.string()).nullable(),
    summaryProvider: aiIndexSummaryProviderSchema.optional(),
  }),
  generatedAt: isoDateTimeSchema,
  indexingStats: aiRepositoryIndexingStatsSchema.optional(),
  monorepoRoot: z.string().trim().min(1),
  repositories: z.array(aiRepositoryIndexResultSchema),
  schemaVersion: z.string().trim().min(1).optional(),
})

export const aiEvidenceSearchRequestSchema = z.object({
  contextBudgetTokens: z.number().int().positive().optional(),
  filePathPrefixes: z.array(z.string().trim().min(1)).optional(),
  minScore: z.number().min(0).optional(),
  pathHints: z.array(z.string().trim().min(1)).optional(),
  query: z.string().trim().min(1),
  repositoryIds: z.array(z.string().trim().min(1)).optional(),
  symbolHints: z.array(z.string().trim().min(1)).optional(),
  topK: z.number().int().positive().max(100).optional(),
})

export const aiEvidenceSearchResultSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  contextSources: z.array(z.string()).optional(),
  filePath: z.string().trim().min(1),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  rankingReasons: z.array(z.string()).optional(),
  relevanceScore: z.number(),
  repositoryId: z.string().trim().min(1),
  repositoryName: z.string().trim().min(1),
  scoreBreakdown: z
    .object({
      bm25: z.number().optional(),
      contextBuilder: z.number().optional(),
      fileImportance: z.number().optional(),
      final: z.number(),
      fusion: z.number().optional(),
      graphBoost: z.number().optional(),
      lexical: z.number(),
      pathBoost: z.number(),
      rerank: z.number().optional(),
      symbolBoost: z.number(),
      vector: z.number(),
    })
    .optional(),
  snippet: z.string(),
  sourceUri: z.string().trim().min(1),
})

export const aiEvidenceSearchResponseSchema = z.object({
  cacheHit: z.boolean().optional(),
  fallbackUsed: z.boolean(),
  generatedAt: isoDateTimeSchema,
  items: z.array(aiEvidenceSearchResultSchema),
  stageFlags: z.record(z.string(), z.boolean()).optional(),
  stageTimingsMs: z.record(z.string(), z.number()).optional(),
  status: z.enum(['ready', 'empty']),
  totalCandidates: z.number().int().nonnegative(),
  totalMatches: z.number().int().nonnegative(),
  vectorProvider: z.string().trim().min(1),
  warnings: z.array(z.string()),
})

export const aiIndexRuntimeCacheIdentitySchema = z.object({
  chunkCount: z.number().int().nonnegative(),
  generatedAt: isoDateTimeSchema,
  repositoryCount: z.number().int().nonnegative(),
  schemaVersion: z.string().trim().min(1),
})

export const aiIndexRuntimeBuildDiagnosticsSchema = z.object({
  buildDurationMs: z.number().int().nonnegative(),
  builtAt: isoDateTimeSchema,
  filePathKeyCount: z.number().int().nonnegative(),
  reverseDependencyKeyCount: z.number().int().nonnegative(),
  symbolKeyCount: z.number().int().nonnegative(),
  trigramKeyCount: z.number().int().nonnegative(),
  wordKeyCount: z.number().int().nonnegative(),
})

export const aiIndexRuntimeCacheInvalidationSchema = z.object({
  invalidatedAt: isoDateTimeSchema,
  previousIdentity: aiIndexRuntimeCacheIdentitySchema.nullable(),
  reason: z.string().trim().min(1),
})

export const aiRetrievalBenchmarkCaseSchema = z.object({
  acceleratedCandidates: z.number().int().nonnegative(),
  acceleratedDurationMs: z.number().int().nonnegative(),
  acceleratedMatches: z.number().int().nonnegative(),
  baselineCandidates: z.number().int().nonnegative(),
  baselineDurationMs: z.number().int().nonnegative(),
  baselineMatches: z.number().int().nonnegative(),
  candidateReductionRatio: z.number(),
  latencyImprovementRatio: z.number(),
  matchedChannels: z.array(z.string()),
  pathHints: z.array(z.string()),
  query: z.string().trim().min(1),
  repositoryIds: z.array(z.string()),
  symbolHints: z.array(z.string()),
})

export const aiRetrievalBenchmarkResultSchema = z.object({
  acceleratedMedianMs: z.number().int().nonnegative(),
  acceleratedP95Ms: z.number().int().nonnegative(),
  averageCandidateReductionRatio: z.number(),
  averageLatencyImprovementRatio: z.number(),
  baselineMedianMs: z.number().int().nonnegative(),
  baselineP95Ms: z.number().int().nonnegative(),
  caseCount: z.number().int().nonnegative(),
  cases: z.array(aiRetrievalBenchmarkCaseSchema),
  generatedAt: isoDateTimeSchema,
  stageFlagsUsed: z.record(z.string(), z.boolean()),
  totalAcceleratedMs: z.number().int().nonnegative(),
  totalBaselineMs: z.number().int().nonnegative(),
})

export const aiRetrievalDiagnosticsSchema = z.object({
  cache: z.object({
    buildDiagnostics: aiIndexRuntimeBuildDiagnosticsSchema.nullable(),
    identity: aiIndexRuntimeCacheIdentitySchema.nullable(),
    lastInvalidation: aiIndexRuntimeCacheInvalidationSchema.nullable().optional(),
    warm: z.boolean(),
  }),
  generatedAt: isoDateTimeSchema,
  lastBenchmark: aiRetrievalBenchmarkResultSchema.nullable(),
  lastRetrieval: z
    .object({
      cacheHit: z.boolean(),
      contextExpansionCount: z.number().int().nonnegative(),
      fallbackUsed: z.boolean(),
      generatedAt: isoDateTimeSchema,
      query: z.string().trim().min(1),
      returnedItems: z.number().int().nonnegative(),
      runtimeCacheIdentity: aiIndexRuntimeCacheIdentitySchema.nullable(),
      stageFlags: z.record(z.string(), z.boolean()),
      stageTimingsMs: z.record(z.string(), z.number()),
      totalCandidates: z.number().int().nonnegative(),
      totalMatches: z.number().int().nonnegative(),
      vectorProvider: z.string().trim().min(1),
    })
    .nullable()
    .optional(),
  stageFlags: z.record(z.string(), z.boolean()),
})

export const aiFailureAnalysisEvidenceSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
  relevanceScore: z.number(),
  snippet: z.string().optional(),
  source: z.string().trim().min(1),
  timestamp: isoDateTimeSchema.optional(),
  title: z.string().trim().min(1),
  uri: z.string().trim().min(1),
})

export const aiFailureAnalysisRequestSchema = z.object({
  allureId: z.string().trim().min(1).optional(),
  failureMessage: z.string().optional(),
  failureTimestamp: isoDateTimeSchema.optional(),
  includeConnectors: z.boolean().optional(),
  includeHistory: z.boolean().optional(),
  includeLogs: z.boolean().optional(),
  includeTrace: z.boolean().optional(),
  repositoryIds: z.array(z.string().trim().min(1)).optional(),
  resultId: z.string().trim().min(1),
  runId: z.number().int().positive(),
  stackTrace: z.string().optional(),
  testName: z.string().trim().min(1).optional(),
  topK: z.number().int().positive().optional(),
})

export const aiFailureAnalysisResponseSchema = z.object({
  confidence: z.number(),
  evidence: z.array(aiFailureAnalysisEvidenceSchema),
  generatedAt: isoDateTimeSchema,
  isFlaky: z.boolean().optional(),
  likelyRootCauses: z.array(z.string()),
  model: z.string().trim().min(1),
  summary: z.string(),
  warnings: z.array(z.string()),
})

export const aiEvidenceConnectorConfigSchema = z.object({
  apiKey: z.string().optional(),
  enabled: z.boolean(),
  endpointUrl: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  timeoutMs: z.number().int().positive().optional(),
  type: z.string().trim().min(1),
})

export const aiConnectorTestRequestSchema = z.object({
  apiKey: z.string().optional(),
  enabled: z.boolean().optional(),
  endpointUrl: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  type: z.string().trim().min(1),
})

export const aiConnectorTestResponseSchema = z.object({
  checkedAt: isoDateTimeSchema,
  connectorType: z.string().trim().min(1),
  message: z.string(),
  normalizedEndpoint: z.string().url().nullable(),
  responseTimeMs: z.number().int().nonnegative(),
  status: z.enum(['ok', 'invalid', 'disabled', 'error', 'timeout', 'auth_failed']),
  warnings: z.array(z.string()),
})

export const aiConnectorTypeInfoSchema = z.object({
  description: z.string(),
  label: z.string().trim().min(1),
  type: z.string().trim().min(1),
})

export const aiAutoIndexConfigSchema = z.object({
  enabled: z.boolean(),
  mainBranch: z.string().trim().min(1).optional(),
  mode: z.enum(['webhook', 'poll', 'both']),
  pollIntervalMinutes: z.number().int().positive().optional(),
  watchIntervalMinutes: z.number().int().positive().optional(),
  watchLocalSources: z.boolean().optional(),
})

export const aiAutoIndexWatchRepositoryStatusSchema = z.object({
  lastChangeDetectedAt: isoDateTimeSchema.nullable(),
  lastEnqueuedAt: isoDateTimeSchema.nullable(),
  lastError: z.string().nullable(),
  lastScannedAt: isoDateTimeSchema.nullable(),
  localPath: z.string().nullable(),
  repositoryId: z.string().trim().min(1),
  snapshotHash: z.string().nullable(),
  sourceType: repositorySourceTypeSchema,
  trackedFileCount: z.number().int().nonnegative(),
})

export const aiAutoIndexWatchStatusSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().positive(),
  lastScanCompletedAt: isoDateTimeSchema.nullable(),
  lastScanStartedAt: isoDateTimeSchema.nullable(),
  repositories: z.array(aiAutoIndexWatchRepositoryStatusSchema),
})

export const aiAutoIndexQueueStatusSchema = z.object({
  currentJob: z
    .object({
      elapsedMs: z.number().int().nonnegative().optional(),
      phase: z.string().trim().min(1).optional(),
      repositoryId: z.string().trim().min(1).optional(),
    })
    .nullable(),
  lastResult: z
    .object({
      durationMs: z.number().int().nonnegative().optional(),
      error: z.string().optional(),
      queuedRepositories: z.number().int().nonnegative().optional(),
      status: z.string().trim().min(1).optional(),
    })
    .nullable()
    .optional(),
  queueDepth: z.number().int().nonnegative(),
})

export const aiAutoIndexStatusSchema = z.object({
  config: aiAutoIndexConfigSchema.nullable(),
  lastIndexedCommits: z.record(
    z.string(),
    z.object({
      indexedAt: isoDateTimeSchema,
      sha: z.string().trim().min(1),
    }),
  ),
  queueStatus: aiAutoIndexQueueStatusSchema,
  watchStatus: aiAutoIndexWatchStatusSchema.optional(),
})

export const aiWebhookProviderSchema = z.enum(['github', 'gitlab', 'bitbucket', 'azure-devops'])

export const aiRegenerateWebhookSecretRequestSchema = z.object({
  provider: aiWebhookProviderSchema,
})

export const aiIndexJobsListSearchSchema = paginationSearchSchema.extend({
  repositoryId: z.string().trim().min(1).optional(),
  sortBy: z.enum(['createdAt', 'finishedAt', 'status']).default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
  status: aiIndexJobStatusSchema.optional(),
})

export const aiFailureAnalysesListSearchSchema = paginationSearchSchema.extend({
  resultId: z.string().trim().min(1).optional(),
  runId: z.number().int().positive().optional(),
  sortBy: z.enum(['confidence', 'createdAt']).default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
})

export type AiConnectorType = z.infer<typeof aiConnectorTypeSchema>
export type RepositorySourceType = z.infer<typeof repositorySourceTypeSchema>
export type AiAnalysisEditionMode = z.infer<typeof aiAnalysisEditionModeSchema>
export type AiCapabilities = z.infer<typeof aiCapabilitiesSchema>
export type AiRepositoryContext = z.infer<typeof aiRepositoryContextSchema>
export type AiRepositoryIndexRequest = z.infer<typeof aiRepositoryIndexRequestSchema>
export type AiIndexJobStatus = z.infer<typeof aiIndexJobStatusSchema>
export type AiRepositoryIndexResult = z.infer<typeof aiRepositoryIndexResultSchema>
export type AiRepositoryIndexResponse = z.infer<typeof aiRepositoryIndexResponseSchema>
export type AiIndexJob = z.infer<typeof aiIndexJobSchema>
export type AiRepositoryIndexCatalog = z.infer<typeof aiRepositoryIndexCatalogSchema>
export type AiEvidenceSearchRequest = z.infer<typeof aiEvidenceSearchRequestSchema>
export type AiEvidenceSearchResult = z.infer<typeof aiEvidenceSearchResultSchema>
export type AiEvidenceSearchResponse = z.infer<typeof aiEvidenceSearchResponseSchema>
export type AiRetrievalDiagnostics = z.infer<typeof aiRetrievalDiagnosticsSchema>
export type AiRetrievalBenchmarkResult = z.infer<typeof aiRetrievalBenchmarkResultSchema>
export type AiFailureAnalysisRequest = z.infer<typeof aiFailureAnalysisRequestSchema>
export type AiFailureAnalysisResponse = z.infer<typeof aiFailureAnalysisResponseSchema>
export type AiEvidenceConnectorConfig = z.infer<typeof aiEvidenceConnectorConfigSchema>
export type AiConnectorTestRequest = z.infer<typeof aiConnectorTestRequestSchema>
export type AiConnectorTestResponse = z.infer<typeof aiConnectorTestResponseSchema>
export type AiConnectorTypeInfo = z.infer<typeof aiConnectorTypeInfoSchema>
export type AiAutoIndexConfig = z.infer<typeof aiAutoIndexConfigSchema>
export type AiAutoIndexStatus = z.infer<typeof aiAutoIndexStatusSchema>
export type AiRegenerateWebhookSecretRequest = z.infer<typeof aiRegenerateWebhookSecretRequestSchema>
export type AiIndexJobsListSearch = z.infer<typeof aiIndexJobsListSearchSchema>
export type AiFailureAnalysesListSearch = z.infer<typeof aiFailureAnalysesListSearchSchema>

/** Provider-agnostic LLM port. Implementations belong to Enterprise modules. */
export type LlmChatMessage = { role: 'assistant' | 'system' | 'user'; content: string }
export type LlmChatResponse = { content: string; model: string; provider: string; reasoningContent?: string }
export type LlmTestConnectionResult = { success: boolean; message: string; latencyMs: number; model: string; provider: string }
export type LlmConnectionInput = { provider?: string; model?: string; apiKey?: string; endpointUrl?: string; baseUrl?: string }
export interface LlmServicePort {
  loadConfig(): Promise<{ provider: string; model: string } | null>
  chat(messages: LlmChatMessage[], options?: { maxTokens?: number; temperature?: number }): Promise<LlmChatResponse>
  chatStream(messages: LlmChatMessage[], options?: { maxTokens?: number; temperature?: number }): AsyncGenerator<string>
  testConnection(input?: LlmConnectionInput): Promise<LlmTestConnectionResult>
}
