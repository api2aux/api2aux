import type { ReactNode } from 'react'
import { navigate } from '../App'
import { Database, LayoutDashboard, Plus, List } from 'lucide-react'

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'APIs', path: '/apis', icon: List },
  { label: 'Add API', path: '/apis/new', icon: Plus },
]

export function Layout({ children }: { children: ReactNode }) {
  const currentHash = window.location.hash.slice(1) || '/dashboard'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 font-semibold">
            <Database className="h-5 w-5" />
            API Catalog
          </button>
          <nav className="flex items-center gap-1">
            {navItems.map(item => {
              const active = currentHash.startsWith(item.path)
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              )
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <a
              href="/docs"
              target="_blank"
              rel="noopener"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              API Docs
            </a>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
    </div>
  )
}
