import { useEffect, useState } from 'react'
import { api, type ApiDetail as ApiDetailType } from '../lib/api'
import { navigate } from '../App'
import { ArrowLeft, ExternalLink, Save, Trash2 } from 'lucide-react'

export function ApiDetail({ id }: { id: string }) {
  const [data, setData] = useState<ApiDetailType | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getById(id)
      .then(d => {
        setData(d)
        setForm({
          name: d.name,
          description: d.description || '',
          category: d.category,
          subcategory: d.subcategory || '',
          baseUrl: d.baseUrl,
          authType: d.authType,
          freeTier: d.freeTier || '',
          status: d.status,
          documentationUrl: d.documentationUrl || '',
          corsSupport: d.corsSupport || '',
        })
      })
      .catch(e => setError(e.message))
  }, [id])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const updated = await api.update(id, form)
      setData({ ...data!, ...updated, operations: data!.operations })
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${data?.name}"? This is a soft delete.`)) return
    try {
      await api.delete(id)
      navigate('/apis')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  if (error && !data) return <p className="text-destructive">{error}</p>
  if (!data) return <p className="text-muted-foreground">Loading...</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/apis')} className="rounded p-1 hover:bg-accent">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-semibold">{data.name}</h1>
        <span className="rounded bg-secondary px-2 py-0.5 text-xs">{data.id}</span>
        <div className="ml-auto flex items-center gap-2">
          {!editing ? (
            <button onClick={() => setEditing(true)} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors">
              Edit
            </button>
          ) : (
            <>
              <button onClick={() => setEditing(false)} className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
          <button onClick={handleDelete} className="rounded-md border border-destructive/30 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Metadata */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h2 className="font-medium">Details</h2>
          <Field label="Name" value={form.name} editing={editing} onChange={v => setForm({ ...form, name: v })} />
          <Field label="Description" value={form.description} editing={editing} onChange={v => setForm({ ...form, description: v })} multiline />
          <Field label="Category" value={form.category} editing={editing} onChange={v => setForm({ ...form, category: v })} />
          <Field label="Subcategory" value={form.subcategory} editing={editing} onChange={v => setForm({ ...form, subcategory: v })} />
          <Field label="Base URL" value={form.baseUrl} editing={editing} onChange={v => setForm({ ...form, baseUrl: v })} />
          <Field label="Auth Type" value={form.authType} editing={editing} onChange={v => setForm({ ...form, authType: v })} />
          <Field label="Free Tier" value={form.freeTier} editing={editing} onChange={v => setForm({ ...form, freeTier: v })} />
          <Field label="Status" value={form.status} editing={editing} onChange={v => setForm({ ...form, status: v })} />
          <Field label="CORS" value={form.corsSupport} editing={editing} onChange={v => setForm({ ...form, corsSupport: v })} />
        </div>

        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h2 className="font-medium">Spec & Links</h2>
          <InfoRow label="Has Spec" value={data.hasSpec ? 'Yes' : 'No'} />
          <InfoRow label="Spec Parsed" value={data.specParsed ? 'Yes' : 'No'} />
          <InfoRow label="Endpoints" value={String(data.endpointCount ?? 0)} />
          <InfoRow label="Spec Format" value={data.specFormat || '—'} />
          <InfoRow label="Source" value={data.source || '—'} />
          <InfoRow label="Created" value={data.createdAt} />
          <InfoRow label="Updated" value={data.updatedAt} />
          {data.documentationUrl && (
            <a href={data.documentationUrl} target="_blank" rel="noopener" className="flex items-center gap-1 text-sm text-primary hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Documentation
            </a>
          )}
        </div>
      </div>

      {/* Operations */}
      {data.operations.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 font-medium">Operations ({data.operations.length})</h2>
          <div className="space-y-1">
            {data.operations.map(op => (
              <div key={op.id} className="flex items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-accent/50">
                <MethodBadge method={op.method} />
                <span className="font-mono text-xs">{op.path}</span>
                <span className="text-muted-foreground truncate">{op.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, value, editing, onChange, multiline }: {
  label: string; value: string; editing: boolean; onChange: (v: string) => void; multiline?: boolean
}) {
  if (!editing) return <InfoRow label={label} value={value || '—'} />
  const cls = "w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} className={cls} />
      ) : (
        <input value={value} onChange={e => onChange(e.target.value)} className={cls} />
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-right truncate">{value}</span>
    </div>
  )
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'bg-blue-100 text-blue-700',
    POST: 'bg-green-100 text-green-700',
    PUT: 'bg-yellow-100 text-yellow-700',
    PATCH: 'bg-orange-100 text-orange-700',
    DELETE: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-mono font-medium ${colors[method.toUpperCase()] || 'bg-secondary text-secondary-foreground'}`}>
      {method.toUpperCase()}
    </span>
  )
}
