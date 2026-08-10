import { z } from 'zod'

import { booleanSearchParamSchema } from './http'

export const dashboardVisualizationSchema = z.enum(['stat', 'line', 'bar', 'area', 'pie', 'table'])

export const dashboardWidgetLayoutSchema = z.object({
  h: z.number().int().nonnegative(),
  w: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
})

export const dashboardWidgetSchema = z.object({
  dataSource: z.string().trim().min(1),
  id: z.string().trim().min(1),
  layout: dashboardWidgetLayoutSchema.optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  title: z.string().trim().min(1),
  visualization: dashboardVisualizationSchema,
})

export const dashboardSchema = z.object({
  id: z.string().trim().min(1),
  isDefault: z.boolean(),
  name: z.string().trim().min(1),
  order: z.number().int().nonnegative(),
  updatedAt: z.string(),
  widgets: z.array(dashboardWidgetSchema),
})

export const dashboardStateSchema = z.object({
  dashboards: z.array(dashboardSchema),
})

export const createDashboardRequestSchema = z.object({
  isDefault: z.boolean().optional(),
  name: z.string().trim().min(1).optional(),
  order: z.number().int().nonnegative().optional(),
  widgets: z.array(dashboardWidgetSchema).optional(),
})

export const updateDashboardRequestSchema = createDashboardRequestSchema

export const dashboardMetricsSearchSchema = z.object({
  branch: z.string().trim().optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  environment: z.string().trim().optional(),
  refresh: booleanSearchParamSchema.default(false),
  status: z.string().trim().optional(),
  tags: z.string().trim().optional(),
})

export type DashboardWidgetLayout = z.infer<typeof dashboardWidgetLayoutSchema>
export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>
export type Dashboard = z.infer<typeof dashboardSchema>
export type DashboardState = z.infer<typeof dashboardStateSchema>
export type CreateDashboardRequest = z.infer<typeof createDashboardRequestSchema>
export type UpdateDashboardRequest = z.infer<typeof updateDashboardRequestSchema>
export type DashboardMetricsSearch = z.infer<typeof dashboardMetricsSearchSchema>
