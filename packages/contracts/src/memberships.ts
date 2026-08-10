import { z } from 'zod'

import { userSchema } from './auth'
import {
  includeArchivedSearchSchema,
  isoDateTimeSchema,
  paginationSearchSchema,
  sortOrderSchema,
  textSearchSchema,
} from './http'
import { projectSchema } from './projects'

export const membershipRoleSchema = z.enum(['owner', 'maintainer', 'viewer'])

export const membershipUserSummarySchema = userSchema.pick({
  id: true,
  name: true,
  email: true,
  role: true,
  avatar: true,
})

export const membershipProjectSummarySchema = projectSchema.pick({
  id: true,
  key: true,
  name: true,
  isArchived: true,
})

export const meMembershipSchema = z.object({
  createdAt: isoDateTimeSchema.optional(),
  project: membershipProjectSummarySchema,
  projectRole: membershipRoleSchema,
  updatedAt: isoDateTimeSchema.optional(),
})

export const projectMembershipRecordSchema = z.object({
  createdAt: isoDateTimeSchema,
  project: membershipProjectSummarySchema,
  projectRole: membershipRoleSchema,
  updatedAt: isoDateTimeSchema,
  user: membershipUserSummarySchema,
})

export const upsertProjectMembershipRequestSchema = z.object({
  projectRole: membershipRoleSchema,
  userId: z.string().trim().min(1),
})

export const userMembershipAccessSchema = z.object({
  memberships: z.array(meMembershipSchema),
  user: membershipUserSummarySchema,
})

export const projectMembershipsListSearchSchema = paginationSearchSchema.merge(textSearchSchema).extend({
  role: membershipRoleSchema.optional(),
  sortBy: z.enum(['createdAt', 'projectRole', 'userEmail', 'userName']).default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
})

export const meMembershipsListSearchSchema = paginationSearchSchema
  .merge(includeArchivedSearchSchema)
  .merge(textSearchSchema)
  .extend({
    role: membershipRoleSchema.optional(),
    sortBy: z.enum(['projectName', 'projectRole', 'updatedAt']).default('projectName'),
    sortOrder: sortOrderSchema.default('asc'),
  })

export type MembershipRole = z.infer<typeof membershipRoleSchema>
export type MembershipUserSummary = z.infer<typeof membershipUserSummarySchema>
export type MembershipProjectSummary = z.infer<typeof membershipProjectSummarySchema>
export type MeMembership = z.infer<typeof meMembershipSchema>
export type ProjectMembershipRecord = z.infer<typeof projectMembershipRecordSchema>
export type UpsertProjectMembershipRequest = z.infer<typeof upsertProjectMembershipRequestSchema>
export type UserMembershipAccess = z.infer<typeof userMembershipAccessSchema>
export type ProjectMembershipsListSearch = z.infer<typeof projectMembershipsListSearchSchema>
export type MeMembershipsListSearch = z.infer<typeof meMembershipsListSearchSchema>
