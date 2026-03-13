import { useState } from 'react'
import { api } from '../lib/api'
import { navigate } from '../App'
import { ArrowLeft } from 'lucide-react'

const FIELDS = [
  { key: 'id', label: 'ID (slug)', required: true, placeholder: 'my-api' },
  { key: 'name', label: 'Name', required: true, placeholder: 'My API' },
  { key: 'category', label: 'Category', required: true, placeholder: 'Weather' },
  { key: 'baseUrl', label: 'Base URL', required: true, placeholder: 'https://api.example.com' },
  { key: 'description', label: 'Description', multiline: true },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'authType', label: 'Auth Type', placeholder: 'none' },
  { key: 'freeTier', label: 'Free Tier', placeholder: 'yes, no, freemium' },
  { key: 'documentationUrl', label: 'Documentation URL' },
  { key: 'corsSupport', label: 'CORS Support' },
] as const

export function ApiCreate() {
  const [form, setForm] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const created = await api.create(form)
      navigate(`/apis/${created.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/apis')} className="rounded p-1 hover:bg-accent">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-semibold">Add API</h1>
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="mb-1 block text-sm font-medium">
              {f.label} {'required' in f && f.required && <span className="text-destructive">*</span>}
            </label>
            {'multiline' in f && f.multiline ? (
              <textarea
                value={form[f.key] || ''}
                onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <input
                value={form[f.key] || ''}
                onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={'placeholder' in f ? f.placeholder : ''}
                required={'required' in f && f.required}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            )}
          </div>
        ))}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create API'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/apis')}
            className="rounded-md border border-input px-4 py-2 text-sm hover:bg-accent transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
