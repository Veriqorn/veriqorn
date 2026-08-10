import { z } from 'zod'

import { booleanSearchParamSchema, includeArchivedSearchSchema, sortOrderSchema } from './http'

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  description: z.string().nullable(),
  isDefault: z.boolean(),
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const projectLifecycleSchema = z.enum(['active', 'archived'])

export const projectRoleSchema = z.enum(['owner', 'maintainer', 'viewer'])

export const createProjectRequestSchema = z.object({
  description: z.string().trim().optional(),
  isDefault: z.boolean().optional(),
  key: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
})

export const updateProjectRequestSchema = z.object({
  description: z.string().trim().optional(),
  isArchived: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  key: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
})

export const projectContractSchema = z.object({
  defaultProject: z.object({
    canArchive: z.boolean(),
    canDelete: z.boolean(),
    id: z.string(),
    isArchived: z.boolean(),
  }),
  lifecycle: z.array(projectLifecycleSchema),
  operations: z.array(z.enum(['list', 'create', 'update', 'archive', 'delete'])),
})

export const projectMembershipSchema = z.object({
  createdAt: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  projectRole: projectRoleSchema,
  updatedAt: z.string(),
  userEmail: z.string().email(),
  userId: z.number().int().positive(),
  userName: z.string(),
})

export const assignProjectMemberRequestSchema = z.object({
  projectRole: projectRoleSchema,
  userId: z.coerce.number().int().positive(),
})

export const projectDeleteSearchSchema = z.object({
  hardDelete: booleanSearchParamSchema.optional(),
  permanent: booleanSearchParamSchema.optional(),
})

export const projectAccessSearchSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
})

export const projectsListSearchSchema = includeArchivedSearchSchema.extend({
  sortBy: z.enum(['createdAt', 'name', 'updatedAt']).default('updatedAt'),
  sortOrder: sortOrderSchema.default('desc'),
})

export type Project = z.infer<typeof projectSchema>
export type ProjectLifecycle = z.infer<typeof projectLifecycleSchema>
export type ProjectRole = z.infer<typeof projectRoleSchema>
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>
export type ProjectContract = z.infer<typeof projectContractSchema>
export type ProjectMembership = z.infer<typeof projectMembershipSchema>
export type AssignProjectMemberRequest = z.infer<typeof assignProjectMemberRequestSchema>
export type ProjectDeleteSearch = z.infer<typeof projectDeleteSearchSchema>
export type ProjectAccessSearch = z.infer<typeof projectAccessSearchSchema>
export type ProjectsListSearch = z.infer<typeof projectsListSearchSchema>
