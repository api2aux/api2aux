import { useEffect, useState } from 'react'
import { api, type Facets } from '../lib/api'
import { navigate } from '../App'
import { Database, FileCode, Shield, Zap } from 'lucide-react'

export function Dashboard() {
  const [facets, setFacets] = useState<Facets | null>(null)
  const [stats, setStats] = useState<{ total: number; withSpec: number } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api.facets(),
      api.search({ limit: '1' }),
      api.search({ limit: '1', hasSpec: 'true' }),
    ]).then(([f, all, specced]) => {
      setFacets(f)
      setStats({ total: all.total, withSpec: specced.total })
    }).catch(e => setError(e.message))
  }, [])

  if (error) return <p className="text-destructive">{error}</p>
  if (!facets || !stats) return <p className="text-muted-foreground">Loading...</p>

  const specCoverage = stats.total > 0 ? Math.round((stats.withSpec / stats.total) * 100) : 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Database} label="Total APIs" value={stats.total} />
        <StatCard icon={FileCode} label="With Spec" value={`${stats.withSpec} (${specCoverage}%)`} />
        <StatCard icon={Shield} label="Auth Types" value={facets.authTypes.length} />
        <StatCard icon={Zap} label="Categories" value={facets.categories.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <FacetCard title="Categories" entries={facets.categories} filterKey="category" />
        <FacetCard title="Auth Types" entries={facets.authTypes} filterKey="authType" />
        <FacetCard title="Free Tier" entries={facets.freeTiers} filterKey="freeTier" />
        <FacetCard title="Status" entries={facets.statuses} filterKey="status" />
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-primary/10 p-2">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
      </div>
    </div>
  )
}

function FacetCard({ title, entries, filterKey }: { title: string; entries: { value: string; count: number }[]; filterKey: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 font-medium">{title}</h3>
      <div className="space-y-1.5">
        {entries.slice(0, 10).map(e => (
          <button
            key={e.value}
            onClick={() => navigate(`/apis?${filterKey}=${encodeURIComponent(e.value)}`)}
            className="flex w-full items-center justify-between rounded px-2 py-1 text-sm hover:bg-accent transition-colors"
          >
            <span className="truncate">{e.value}</span>
            <span className="ml-2 shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
              {e.count}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
