import { createRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { env } from '@/lib/env'
import { buildProjectDashboardPath, resolveStoredProjectId } from '@/lib/project-paths'
import { resolveCanonicalProjectId } from '@/lib/queries'
import { useAuth } from '@/providers/auth-provider'
import { useToast } from '@/providers/toast-provider'
import { rootRoute } from '@/routes/root'
import { validateLoginSearch } from '@/router/search'

export const loginRoute = createRoute({
  beforeLoad: async ({ context }) => {
    const auth = await context.auth.ensureInitialized()

    if (auth.status === 'authenticated') {
      if (auth.user?.role === 'kb_viewer') {
        throw redirect({ href: env.kbUrl })
      }

      const projectId = await resolveCanonicalProjectId({
        apiClient: context.apiClient,
        preferredProjectId: resolveStoredProjectId(),
        queryClient: context.queryClient,
      })

      throw redirect({ href: buildProjectDashboardPath(projectId) })
    }
  },
  component: LoginPage,
  getParentRoute: () => rootRoute,
  path: 'login',
  validateSearch: validateLoginSearch,
})

function LoginPage() {
  const navigate = useNavigate()
  const { login, status } = useAuth()
  const { showToast } = useToast()
  const search = loginRoute.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const redirectTarget = useMemo(() => search.redirectTo || '/', [search.redirectTo])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await login(email, password)
      showToast('Signed in successfully.', 'success')
      await navigate({ href: redirectTarget, replace: true })
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : 'Unable to sign in.'
      setError(message)
      showToast(message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm space-y-8">
        <h1 className="text-center text-3xl font-semibold tracking-tight text-foreground">
          {env.appName}
        </h1>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              autoComplete="email"
              data-testid="auth-email-input"
              id="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              required
              type="email"
              value={email}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              autoComplete="current-password"
              data-testid="auth-password-input"
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
              type="password"
              value={password}
            />
          </div>

          <Button
            className="w-full justify-center"
            data-testid="auth-submit"
            disabled={isSubmitting || status === 'loading'}
            size="lg"
            type="submit"
          >
            {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  )
}
