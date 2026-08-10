import { useMutation, useQuery } from '@tanstack/react-query'
import { createRoute } from '@tanstack/react-router'
import { KeyRound, LoaderCircle, Save, Shield, User } from 'lucide-react'
import { useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isApiError, unwrapApiData } from '@/lib/api'
import { useRuntime } from '@/providers/runtime-provider'
import { useAuth } from '@/providers/auth-provider'
import { authedRoute } from '@/routes/authed'

export const profileRoute = createRoute({
  component: ProfilePage,
  getParentRoute: () => authedRoute,
  path: 'profile',
})

function ProfilePage() {
  const { apiClient } = useRuntime()
  const { logout, refresh, user } = useAuth()

  // Profile data
  const profileQuery = useQuery({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>('/api/v1/me')
      return unwrapApiData(payload) as Record<string, unknown>
    },
    queryKey: ['profile', 'me'],
  })

  const profileData = profileQuery.data ?? {}

  // Edit profile state
  const [name, setName] = useState('')
  const [nameInitialized, setNameInitialized] = useState(false)
  if (!nameInitialized && profileData.name) {
    setName(String(profileData.name))
    setNameInitialized(true)
  }

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [profileMessage, setProfileMessage] = useState<{ tone: 'error' | 'success'; value: string } | null>(null)
  const [passwordMessage, setPasswordMessage] = useState<{ tone: 'error' | 'success'; value: string } | null>(null)

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      const payload = await apiClient.post<unknown>('/api/v1/me', { name: name.trim() })
      return unwrapApiData(payload)
    },
    onError: (err) => setProfileMessage({ tone: 'error', value: isApiError(err) ? err.message : 'Failed to update profile.' }),
    onSuccess: async () => {
      setProfileMessage({ tone: 'success', value: 'Profile updated.' })
      await refresh()
    },
  })

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) throw new Error('Passwords do not match.')
      if (newPassword.length < 6) throw new Error('Password must be at least 6 characters.')
      const payload = await apiClient.post<unknown>('/api/v1/me/password', {
        currentPassword,
        newPassword,
      })
      return unwrapApiData(payload)
    },
    onError: (err) => setPasswordMessage({ tone: 'error', value: isApiError(err) ? err.message : String((err as Error).message ?? 'Failed.') }),
    onSuccess: () => {
      setPasswordMessage({ tone: 'success', value: 'Password changed successfully.' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    },
  })

  // API keys
  const apiKeysQuery = useQuery({
    queryFn: async () => {
      const payload = await apiClient.get<unknown>('/api/v1/me/api-keys')
      const source = unwrapApiData(payload)
      return Array.isArray(source) ? source as Array<{ id: number; name: string; keyPrefix: string; createdAt: string; expiresAt?: string }> : []
    },
    queryKey: ['profile', 'api-keys'],
  })

  const email = String(profileData.email ?? user?.email ?? '')
  const role = String(profileData.role ?? user?.role ?? 'user')

  return (
    <div className="space-y-6">
      <section className="grid gap-6 xl:grid-cols-[0.55fr_0.45fr]">
        {/* Profile info card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4" />
              Account profile
            </CardTitle>
            <CardDescription>Manage your name and account information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Identity */}
            <div className="grid gap-3 rounded-2xl border border-border bg-secondary/50 p-4 sm:grid-cols-2">
              <InfoRow label="Email" value={email} />
              <InfoRow label="Role" value={role} />
              <InfoRow label="ID" value={String(profileData.id ?? user?.id ?? '')} />
            </div>

            {/* Edit name */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Display name</Label>
                <Input
                  id="profile-name"
                  onChange={(e) => setName(e.target.value)}
                  value={name}
                />
              </div>

              {profileMessage && (
                <Alert variant={profileMessage.tone === 'success' ? 'default' : 'destructive'}>
                  <AlertDescription>{profileMessage.value}</AlertDescription>
                </Alert>
              )}

              <Button
                className="gap-2"
                disabled={updateProfileMutation.isPending}
                onClick={() => updateProfileMutation.mutate()}
              >
                {updateProfileMutation.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save profile
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Session card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              Session
            </CardTitle>
            <CardDescription>Manage your active session.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-border bg-secondary/50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
              <p className="mt-2 text-sm font-semibold text-emerald-600">Authenticated</p>
            </div>
            <Button
              className="w-full gap-2"
              onClick={() => { void refresh() }}
              variant="outline"
            >
              Refresh session
            </Button>
            <Button
              className="w-full gap-2"
              onClick={() => { void logout() }}
              variant="destructive"
            >
              Sign out
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Change password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change password</CardTitle>
          <CardDescription>Update your account password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Current password</Label>
              <Input
                onChange={(e) => setCurrentPassword(e.target.value)}
                type="password"
                value={currentPassword}
              />
            </div>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input
                onChange={(e) => setNewPassword(e.target.value)}
                type="password"
                value={newPassword}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm new password</Label>
              <Input
                onChange={(e) => setConfirmPassword(e.target.value)}
                type="password"
                value={confirmPassword}
              />
            </div>
          </div>

          {passwordMessage && (
            <Alert variant={passwordMessage.tone === 'success' ? 'default' : 'destructive'}>
              <AlertDescription>{passwordMessage.value}</AlertDescription>
            </Alert>
          )}

          <Button
            className="gap-2"
            disabled={changePasswordMutation.isPending || !currentPassword || !newPassword}
            onClick={() => changePasswordMutation.mutate()}
          >
            {changePasswordMutation.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Shield className="h-4 w-4" />
            )}
            Change password
          </Button>
        </CardContent>
      </Card>

      {/* API keys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            API keys
          </CardTitle>
          <CardDescription>Keys for programmatic access. Manage full key details in Settings → API Keys.</CardDescription>
        </CardHeader>
        <CardContent>
          {apiKeysQuery.isLoading ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Loading API keys…
            </div>
          ) : apiKeysQuery.data && apiKeysQuery.data.length > 0 ? (
            <div className="space-y-2">
              {apiKeysQuery.data.map((key) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/50 px-4 py-3"
                  key={key.id}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{key.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{key.keyPrefix}•••••</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {key.expiresAt ? `Expires ${new Date(key.expiresAt).toLocaleDateString()}` : 'No expiry'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No API keys. Create one in Settings → API Keys.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-foreground break-all">{value || '—'}</dd>
    </div>
  )
}
