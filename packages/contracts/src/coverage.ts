import { z } from 'zod'

import { isoDateTimeSchema, paginationSearchSchema, sortOrderSchema, textSearchSchema } from './http'

export const coverageUnitTypeSchema = z.enum(['api_endpoint', 'ui_flow', 'domain_operation'])

export const coveragePrioritySchema = z.enum(['critical', 'high', 'medium', 'low'])

export const coverageConfidenceBandSchema = z.enum(['high', 'medium', 'low'])

export const coverageUnitSchema = z.object({
  displayName: z.string().trim().min(1),
  isCritical: z.boolean(),
  moduleKey: z.string().trim().min(1),
  owner: z.string().trim().min(1).optional(),
  unitId: z.string().trim().min(1),
  unitType: coverageUnitTypeSchema,
})

export const coverageEvidenceSchema = z.object({
  assertionDepth: z.number(),
  codePresence: z.number(),
  executionFreshness: z.number(),
  executionStability: z.number(),
  incidentLink: z.number(),
  testPresence: z.number(),
  unitId: z.string().trim().min(1),
})

export const coverageInventoryItemSchema = coverageUnitSchema.extend({
  evidence: coverageEvidenceSchema,
})

export const coverageScoreBreakdownSchema = z.object({
  displayName: z.string().trim().min(1),
  effectiveCoverage: z.number(),
  evidence: coverageEvidenceSchema,
  moduleKey: z.string().trim().min(1),
  riskWeight: z.number(),
  unitConfidence: z.number(),
  unitId: z.string().trim().min(1),
})

export const coverageModuleSchema = z.object({
  averageConfidence: z.number(),
  coverageScore: z.number(),
  coveredUnits: z.number().int().nonnegative(),
  moduleKey: z.string().trim().min(1),
  unitCount: z.number().int().nonnegative(),
})

export const coverageGapSchema = z.object({
  displayName: z.string().trim().min(1),
  effectiveCoverage: z.number(),
  moduleKey: z.string().trim().min(1),
  priority: coveragePrioritySchema,
  reason: z.string(),
  riskWeight: z.number(),
  unitId: z.string().trim().min(1),
})

export const coverageSummarySchema = z.object({
  confidenceBand: coverageConfidenceBandSchema,
  coveredUnits: z.number().int().nonnegative(),
  generatedAt: isoDateTimeSchema,
  projectConfidence: z.number(),
  projectCoverageScore: z.number(),
  totalUnits: z.number().int().nonnegative(),
})

export const coverageRecommendationSchema = z.object({
  confidence: z.number(),
  coverageReason: z.string(),
  estimatedImpact: z.object({
    confidenceDelta: z.number(),
    coverageDelta: z.number(),
  }),
  priority: coveragePrioritySchema,
  projectId: z.string().trim().min(1),
  recommendationId: z.string().trim().min(1),
  riskReason: z.string(),
  suggestedScenario: z.object({
    given: z.array(z.string()),
    then: z.array(z.string()),
    title: z.string().trim().min(1),
    when: z.array(z.string()),
  }),
  unitId: z.string().trim().min(1),
})

export const coverageInventorySchema = z.object({
  generatedAt: isoDateTimeSchema.nullable(),
  projectId: z.string().trim().min(1),
  totalUnits: z.number().int().nonnegative(),
  units: z.array(coverageInventoryItemSchema),
})

export const coverageRecommendationJobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed'])

export const coverageRecommendationJobSchema = z.object({
  createdAt: isoDateTimeSchema,
  errorMessage: z.string().nullable().optional(),
  finishedAt: isoDateTimeSchema.nullable().optional(),
  generatedRecommendations: z.number().int().nonnegative().optional(),
  id: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  startedAt: isoDateTimeSchema.nullable().optional(),
  status: coverageRecommendationJobStatusSchema,
})

export const coverageInventorySearchSchema = paginationSearchSchema.merge(textSearchSchema).extend({
  criticalOnly: z.boolean().optional(),
  moduleKey: z.string().trim().min(1).optional(),
  sortBy: z.enum(['displayName', 'moduleKey', 'unitType']).default('displayName'),
  sortOrder: sortOrderSchema.default('asc'),
  unitType: coverageUnitTypeSchema.optional(),
})

export const coverageGapsSearchSchema = paginationSearchSchema.merge(textSearchSchema).extend({
  moduleKey: z.string().trim().min(1).optional(),
  priority: coveragePrioritySchema.optional(),
  sortBy: z.enum(['effectiveCoverage', 'priority', 'riskWeight']).default('priority'),
  sortOrder: sortOrderSchema.default('desc'),
  unitType: coverageUnitTypeSchema.optional(),
})

export const coverageRecommendationsSearchSchema = paginationSearchSchema.merge(textSearchSchema).extend({
  moduleKey: z.string().trim().min(1).optional(),
  priority: coveragePrioritySchema.optional(),
  sortBy: z.enum(['confidence', 'priority']).default('priority'),
  sortOrder: sortOrderSchema.default('desc'),
})

export type CoverageUnitType = z.infer<typeof coverageUnitTypeSchema>
export type CoveragePriority = z.infer<typeof coveragePrioritySchema>
export type CoverageConfidenceBand = z.infer<typeof coverageConfidenceBandSchema>
export type CoverageUnit = z.infer<typeof coverageUnitSchema>
export type CoverageEvidence = z.infer<typeof coverageEvidenceSchema>
export type CoverageInventoryItem = z.infer<typeof coverageInventoryItemSchema>
export type CoverageScoreBreakdown = z.infer<typeof coverageScoreBreakdownSchema>
export type CoverageModule = z.infer<typeof coverageModuleSchema>
export type CoverageGap = z.infer<typeof coverageGapSchema>
export type CoverageSummary = z.infer<typeof coverageSummarySchema>
export type CoverageRecommendation = z.infer<typeof coverageRecommendationSchema>
export type CoverageInventory = z.infer<typeof coverageInventorySchema>
export type CoverageRecommendationJobStatus = z.infer<typeof coverageRecommendationJobStatusSchema>
export type CoverageRecommendationJob = z.infer<typeof coverageRecommendationJobSchema>
export type CoverageInventorySearch = z.infer<typeof coverageInventorySearchSchema>
export type CoverageGapsSearch = z.infer<typeof coverageGapsSearchSchema>
export type CoverageRecommendationsSearch = z.infer<typeof coverageRecommendationsSearchSchema>
