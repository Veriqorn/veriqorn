import { z } from 'zod'

export const reserveTestCaseIdRequestSchema = z.object({
  testIdentity: z.string().trim().min(1).max(400),
  testName: z.string().trim().min(1).max(400).optional(),
})

export const testCaseIdRegistryStatusSchema = z.enum(['reserved', 'claimed', 'conflicted'])

export const testCaseIdReservationSchema = z.object({
  id: z.string().uuid(),
  testCaseId: z.string().trim().min(1),
  testIdentity: z.string().trim().min(1),
  testName: z.string().trim().optional().nullable(),
  status: testCaseIdRegistryStatusSchema,
  reservedBy: z.string().trim().optional().nullable(),
  claimedAt: z.string().optional().nullable(),
  lastSeenAt: z.string(),
  conflictCount: z.number().int().nonnegative(),
  lastConflictingIdentity: z.string().trim().optional().nullable(),
  lastConflictingName: z.string().trim().optional().nullable(),
  lastConflictAt: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ReserveTestCaseIdRequest = z.infer<typeof reserveTestCaseIdRequestSchema>
