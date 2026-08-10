import { z } from 'zod'

export const userRoleSchema = z.enum(['admin', 'kb_viewer', 'user'])

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: userRoleSchema,
  avatar: z.string().nullable().optional(),
})

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const sessionSchema = z.object({
  user: userSchema,
})

export type UserRole = z.infer<typeof userRoleSchema>
export type User = z.infer<typeof userSchema>
export type LoginRequest = z.infer<typeof loginRequestSchema>
export type Session = z.infer<typeof sessionSchema>
