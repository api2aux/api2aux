import { useEffect, useState, useCallback } from 'react'
import { api, type Api, type SearchResult, type Facets } from '../lib/api'
import { navigate } from '../App'
import { Search, ChevronLeft, ChevronRight, FileCode } from 'lucide-react'

export function ApiList() {
  const [result, setResult] = useState<SearchResult | null>(null)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(() => parseFiltersFromHash())
  const [query, setQuery] = useState(filters.q || '')

  const load = useCallback((f: Record<string, string>) => {
    const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v))
    api.search({ limit: '20', ...params }).then(setResult).catch(e => setError(e.message))
  }, [])

  useEffect(() => {
    api.facets().then(setFacets).catch(() => {})
    load(filters)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilters(patch: Record<string, string>) {
    const next = { ...filters, ...patch, page: '1' }
    setFilters(next)
    load(next)
  }

  function setPage(p: number) {
    const next = { ...filters, page: String(p) }
    setFilters(next)
    load(next)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">APIs</h1>
        <button
          onClick={() => navigate('/apis/new')}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Add API
        </button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search APIs..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') applyFilters({ q: query }) }}
          className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Filter chips */}
      {facets && (
        <div className="flex flex-wrap gap-2">
          <FilterSelect label="Category" options={facets.categories} value={filters.category} onChange={v => applyFilters({ category: v })} />
          <FilterSelect label="Auth" options={facets.authTypes} value={filters.authType} onChange={v => applyFilters({ authType: v })} />
          <FilterSelect label="Free Tier" options={facets.freeTiers} value={filters.freeTier} onChange={v => applyFilters({ freeTier: v })} />
          <FilterSelect label="Status" options={facets.statuses} value={filters.status} onChange={v => applyFilters({ status: v })} />
          <FilterToggle label="Has Spec" value={filters.hasSpec} onChange={v => applyFilters({ hasSpec: v })} />
        </div>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Table */}
      {result && (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Auth</th>
                  <th className="px-4 py-2 font-medium">Free Tier</th>
                  <th className="px-4 py-2 font-medium">Spec</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.items.map(a => (
                  <ApiRow key={a.id} api={a} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{result.total} APIs total</span>
            <div className="flex items-center gap-2">
              <button
                disabled={result.page <= 1}
                onClick={() => setPage(result.page - 1)}
                className="rounded p-1 hover:bg-accent disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span>Page {result.page} of {result.totalPages}</span>
              <button
                disabled={result.page >= result.totalPages}
                onClick={() => setPage(result.page + 1)}
                className="rounded p-1 hover:bg-accent disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ApiRow({ api: a }: { api: Api }) {
  return (
    <tr className="hover:bg-accent/50 cursor-pointer transition-colors" onClick={() => navigate(`/apis/${a.id}`)}>
      <td className="px-4 py-2">
        <div className="font-medium">{a.name}</div>
        <div className="text-xs text-muted-foreground truncate max-w-[300px]">{a.description}</div>
      </td>
      <td className="px-4 py-2">{a.category}</td>
      <td className="px-4 py-2">
        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs">{a.authType}</span>
      </td>
      <td className="px-4 py-2">{a.freeTier || '—'}</td>
      <td className="px-4 py-2">
        {a.hasSpec ? <FileCode className="h-4 w-4 text-green-600" /> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-2">
        <StatusBadge status={a.status} />
      </td>
    </tr>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    deprecated: 'bg-yellow-100 text-yellow-800',
    beta: 'bg-blue-100 text-blue-800',
    disabled: 'bg-red-100 text-red-800',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || 'bg-secondary text-secondary-foreground'}`}>
      {status}
    </span>
  )
}

function FilterSelect({ label, options, value, onChange }: {
  label: string
  options: { value: string; count: number }[]
  value?: string
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      className="rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="">{label}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.value} ({o.count})</option>
      ))}
    </select>
  )
}

function FilterToggle({ label, value, onChange }: {
  label: string
  value?: string
  onChange: (v: string) => void
}) {
  return (
    <button
      onClick={() => onChange(value === 'true' ? '' : 'true')}
      className={`rounded-md border px-2 py-1 text-sm transition-colors ${
        value === 'true' ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function parseFiltersFromHash(): Record<string, string> {
  const hash = window.location.hash
  const qIdx = hash.indexOf('?')
  if (qIdx < 0) return {}
  return Object.fromEntries(new URLSearchParams(hash.slice(qIdx + 1)))
}
