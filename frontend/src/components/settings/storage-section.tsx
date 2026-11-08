import { storageConnectionRequestSchema, storageSettingsSchema } from '@veriqorn/contracts'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isApiError, unwrapApiData, type ApiClient } from '@/lib/api'

const storagePath = '/api/v1/system/storage'
const initialForm = { name: '', region: 'us-east-1', bucket: '', prefix: '', endpoint: 'http://minio:9000', accessKey: '', secretKey: '', sessionToken: '' }

export function StorageSection({ apiClient, isAdmin }: { apiClient: ApiClient; isAdmin: boolean }) {
  const [provider, setProvider] = useState<'s3' | 'minio'>('s3')
  const [form, setForm] = useState(initialForm)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const query = useQuery({
    queryKey: ['settings', 'storage'],
    enabled: isAdmin,
    queryFn: async () => storageSettingsSchema.parse(unwrapApiData(await apiClient.get<unknown>(`${storagePath}/`))),
  })

  if (!isAdmin) return <Alert><AlertTitle>Administrator access required</AlertTitle><AlertDescription>Only platform administrators can configure object storage.</AlertDescription></Alert>

  const perform = async (action: string, work: () => Promise<unknown>, success: string) => {
    setBusy(action)
    setMessage(null)
    try {
      await work()
      setMessage({ error: false, text: success })
      await query.refetch()
    } catch (error) {
      setMessage({ error: true, text: isApiError(error) ? error.message : error instanceof Error ? error.message : 'Storage operation failed.' })
    } finally { setBusy(null) }
  }

  const save = () => perform('save', async () => {
    const { endpoint, ...common } = form
    const parsed = storageConnectionRequestSchema.safeParse(provider === 'minio' ? { ...common, provider, endpoint } : { ...common, provider })
    if (!parsed.success) throw new Error(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '))
    await apiClient.post(`${storagePath}/connections`, parsed.data)
    setForm({ ...initialForm })
  }, 'Connection saved. Check it, then activate it for new uploads.')

  const fields = [
    ['name', 'Connection name', 'Production storage'],
    ['region', 'Region', 'us-east-1'],
    ['bucket', 'Existing bucket', 'my-veriqorn-storage'],
    ['prefix', 'Object prefix (optional)', 'veriqorn'],
    ...(provider === 'minio' ? [['endpoint', 'MinIO endpoint', 'https://minio.example.com']] : []),
    ['accessKey', 'Access key', ''],
    ['secretKey', 'Secret key', ''],
    ['sessionToken', 'Session token (optional)', ''],
  ] as Array<[keyof typeof form, string, string]>

  return <div className="space-y-6" data-testid="storage-settings">
    {message ? <Alert role="status" variant={message.error ? 'destructive' : 'default'}><AlertDescription>{message.text}</AlertDescription></Alert> : null}
    <Card>
      <CardHeader><CardTitle className="text-base">Storage connections</CardTitle><CardDescription>Activating a connection changes new uploads. Existing files stay accessible through their original connection.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? <p>Loading storage connections…</p> : null}
        {query.isError ? <Alert variant="destructive"><AlertDescription>Unable to load storage settings.</AlertDescription><Button onClick={() => void query.refetch()} variant="outline">Retry</Button></Alert> : null}
        {query.data && !query.data.activeConnectionId ? <p className="text-sm text-muted-foreground">No object storage is active. Attachments are currently stored in the database.</p> : null}
        {query.data?.connections.map(connection => {
          const active = query.data.activeConnectionId === connection.id
          return <div className="space-y-3 rounded-xl border border-border p-4" data-testid="storage-connection" key={connection.id}>
            <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{connection.name}</p><Badge variant="outline">{connection.provider === 's3' ? 'Amazon S3' : 'MinIO'}</Badge>{active ? <Badge>Active for new uploads</Badge> : null}</div>
            <p className="break-all text-sm text-muted-foreground">{connection.endpoint} · {connection.bucket ?? 'artifacts, traces, screenshots'}{connection.prefix ? ` / ${connection.prefix}` : ''}</p>
            {connection.lastCheckedAt ? <p className="text-xs text-muted-foreground">Last successful check: {new Date(connection.lastCheckedAt).toLocaleString()}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy !== null} onClick={() => void perform(`check:${connection.id}`, () => apiClient.post(`${storagePath}/connections/${connection.id}/check`, {}), 'Connection check passed: write, read, and delete succeeded.')} variant="outline">Check connection</Button>
              <Button disabled={busy !== null || active} onClick={() => void perform(`activate:${connection.id}`, () => apiClient.post(`${storagePath}/connections/${connection.id}/activate`, {}), 'Storage activated for new uploads. Existing files remain in their original storage.')}>Activate</Button>
            </div>
          </div>
        })}
        <p className="text-xs text-muted-foreground">Keep previous connections and their credentials available while they contain files. Activating another connection does not transfer existing files.</p>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle className="text-base">Add connection</CardTitle><CardDescription>Use an existing private bucket. Saved destinations are retained for files already stored there.</CardDescription></CardHeader>
      <CardContent>
        {query.data && !query.data.credentialsEncryptionConfigured ? <Alert><AlertTitle>Credential encryption required</AlertTitle><AlertDescription>Configure VERIQORN_STORAGE_ENCRYPTION_KEY on the backend before adding connections.</AlertDescription></Alert> : null}
        <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
          <div className="space-y-1.5"><Label htmlFor="storage-provider">Provider</Label><select className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" disabled={busy !== null} id="storage-provider" onChange={event => setProvider(event.target.value as 's3' | 'minio')} value={provider}><option value="s3">Amazon S3</option><option value="minio">MinIO</option></select></div>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map(([key, label, placeholder]) => <div className="space-y-1.5" key={key}><Label htmlFor={`storage-${key}`}>{label}</Label><Input autoComplete="off" disabled={busy !== null} id={`storage-${key}`} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} required={!['prefix', 'sessionToken'].includes(key)} type={['accessKey', 'secretKey', 'sessionToken'].includes(key) ? 'password' : 'text'} value={form[key]} /></div>)}
          </div>
          <Button disabled={busy !== null || !query.data?.credentialsEncryptionConfigured} type="submit">{busy === 'save' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}Save connection</Button>
        </form>
      </CardContent>
    </Card>
  </div>
}
