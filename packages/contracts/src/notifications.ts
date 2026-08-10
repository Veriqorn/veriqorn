import { z } from 'zod'

import {
  dateRangeSearchSchema,
  isoDateTimeSchema,
  paginationSearchSchema,
  sortOrderSchema,
  textSearchSchema,
} from './http'

export const notificationDestinationTypeSchema = z.enum(['slack', 'telegram', 'email', 'webhook'])

export const notificationEventTypeSchema = z.enum(['test-run.completed', 'test-run.failed'])

export const notificationMessageModeSchema = z.enum(['summary', 'failures', 'summary+failures'])

export const notificationDeliveryModeSchema = z.enum(['summary', 'per-test'])

export const notificationDeliveryStatusSchema = z.enum(['sent', 'failed', 'skipped'])

export const notificationDestinationSchema = z.object({
  channel: z.string().trim().min(1).optional(),
  enabled: z.boolean(),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: notificationDestinationTypeSchema,
  webhookUrl: z.string().url(),
})

export const notificationRuleSettingsSchema = z.object({
  enabled: z.boolean(),
  events: z.array(notificationEventTypeSchema),
  deliveryMode: notificationDeliveryModeSchema,
  deliveryDelaySeconds: z.number().int().nonnegative(),
  messageMode: notificationMessageModeSchema,
  sendWhenFailedOnly: z.boolean(),
  sendCompletionNotice: z.boolean(),
})

export const notificationTemplatesSchema = z.object({
  failure: z.string(),
  summary: z.string(),
})

export const notificationRuleSchema = z.object({
  createdAt: isoDateTimeSchema.optional(),
  destination: notificationDestinationSchema,
  enabled: z.boolean(),
  events: z.array(notificationEventTypeSchema).min(1),
  deliveryMode: notificationDeliveryModeSchema.default('summary'),
  deliveryDelaySeconds: z.number().int().nonnegative().default(0),
  id: z.string().trim().min(1),
  messageMode: notificationMessageModeSchema,
  name: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  sendWhenFailedOnly: z.boolean().default(false),
  sendCompletionNotice: z.boolean().default(true),
  templates: notificationTemplatesSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
})

export const saveNotificationRuleRequestSchema = z.object({
  destination: notificationDestinationSchema,
  enabled: z.boolean().default(true),
  events: z.array(notificationEventTypeSchema).min(1),
  deliveryMode: notificationDeliveryModeSchema.default('summary'),
  deliveryDelaySeconds: z.number().int().nonnegative().default(0),
  messageMode: notificationMessageModeSchema.default('summary'),
  name: z.string().trim().min(1).max(120),
  sendWhenFailedOnly: z.boolean().default(false),
  sendCompletionNotice: z.boolean().default(true),
  templates: notificationTemplatesSchema.optional(),
})

export const notificationRunSummarySchema = z.object({
  branch: z.string(),
  broken: z.number().int().nonnegative(),
  environment: z.string(),
  failed: z.number().int().nonnegative(),
  failedTests: z.array(z.string()),
  passed: z.number().int().nonnegative(),
  runId: z.number().int().positive(),
  runName: z.string().trim().min(1),
  runUrl: z.string().url(),
  skipped: z.number().int().nonnegative(),
  status: z.enum(['completed', 'failed']),
  total: z.number().int().nonnegative(),
})

export const notificationDispatchResultSchema = z.object({
  attempt: z.number().int().positive(),
  dedupeKey: z.string().trim().min(1),
  destinationId: z.string().trim().min(1),
  destinationType: notificationDestinationTypeSchema,
  error: z.string().optional(),
  responseCode: z.number().int().positive().optional(),
  status: notificationDeliveryStatusSchema,
})

export const notificationDeliverySchema = z.object({
  attempt: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  dedupeKey: z.string().trim().min(1),
  deliveredAt: isoDateTimeSchema.optional(),
  destinationId: z.string().trim().min(1),
  destinationType: notificationDestinationTypeSchema,
  error: z.string().optional(),
  event: notificationEventTypeSchema,
  id: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  responseCode: z.number().int().positive().optional(),
  runId: z.number().int().positive().optional(),
  status: notificationDeliveryStatusSchema,
  triggeredBy: z.enum(['run-completion', 'manual-test']),
})

export const notificationTestDeliveryResponseSchema = z.object({
  failed: z.number().int().nonnegative(),
  results: z.array(notificationDispatchResultSchema),
  sent: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
})

export const sendTestNotificationRequestSchema = z.object({
  destinationId: z.string().trim().min(1).optional(),
  notificationRuleId: z.string().trim().min(1).optional(),
})

export const notificationContractSchema = z.object({
  defaults: z.object({
    rules: notificationRuleSettingsSchema,
    templates: notificationTemplatesSchema,
  }),
  destinationTypes: z.array(notificationDestinationTypeSchema),
  deliveryModes: z.array(notificationDeliveryModeSchema),
  events: z.array(notificationEventTypeSchema),
  generatedAt: isoDateTimeSchema,
  messageModes: z.array(notificationMessageModeSchema),
  version: z.string().trim().min(1),
})

export const notificationRulesListSearchSchema = paginationSearchSchema.merge(textSearchSchema).extend({
  destinationType: notificationDestinationTypeSchema.optional(),
  enabled: z.boolean().optional(),
  event: notificationEventTypeSchema.optional(),
  sortBy: z.enum(['createdAt', 'name', 'updatedAt']).default('updatedAt'),
  sortOrder: sortOrderSchema.default('desc'),
})

export const notificationDeliveriesListSearchSchema = paginationSearchSchema
  .merge(textSearchSchema)
  .merge(dateRangeSearchSchema)
  .extend({
    destinationType: notificationDestinationTypeSchema.optional(),
    event: notificationEventTypeSchema.optional(),
    sortBy: z.enum(['createdAt', 'deliveredAt', 'status']).default('createdAt'),
    sortOrder: sortOrderSchema.default('desc'),
    status: notificationDeliveryStatusSchema.optional(),
  })

export type NotificationDestinationType = z.infer<typeof notificationDestinationTypeSchema>
export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>
export type NotificationMessageMode = z.infer<typeof notificationMessageModeSchema>
export type NotificationDeliveryMode = z.infer<typeof notificationDeliveryModeSchema>
export type NotificationDeliveryStatus = z.infer<typeof notificationDeliveryStatusSchema>
export type NotificationDestination = z.infer<typeof notificationDestinationSchema>
export type NotificationRuleSettings = z.infer<typeof notificationRuleSettingsSchema>
export type NotificationTemplates = z.infer<typeof notificationTemplatesSchema>
export type NotificationRule = z.infer<typeof notificationRuleSchema>
export type SaveNotificationRuleRequest = z.infer<typeof saveNotificationRuleRequestSchema>
export type NotificationRunSummary = z.infer<typeof notificationRunSummarySchema>
export type NotificationDispatchResult = z.infer<typeof notificationDispatchResultSchema>
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>
export type NotificationTestDeliveryResponse = z.infer<typeof notificationTestDeliveryResponseSchema>
export type SendTestNotificationRequest = z.infer<typeof sendTestNotificationRequestSchema>
export type NotificationContract = z.infer<typeof notificationContractSchema>
export type NotificationRulesListSearch = z.infer<typeof notificationRulesListSearchSchema>
export type NotificationDeliveriesListSearch = z.infer<typeof notificationDeliveriesListSearchSchema>
