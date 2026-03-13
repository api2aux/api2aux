import { useState, useEffect } from 'react'
import { Dashboard } from './pages/Dashboard'
import { ApiList } from './pages/ApiList'
import { ApiDetail } from './pages/ApiDetail'
import { ApiCreate } from './pages/ApiCreate'
import { Layout } from './components/Layout'

type Route =
  | { page: 'dashboard' }
  | { page: 'apis' }
  | { page: 'api-detail'; id: string }
  | { page: 'api-create' }

function parseHash(): Route {
  const hash = window.location.hash.slice(1) || '/'
  if (hash === '/' || hash === '/dashboard') return { page: 'dashboard' }
  if (hash === '/apis') return { page: 'apis' }
  if (hash === '/apis/new') return { page: 'api-create' }
  if (hash.startsWith('/apis/')) return { page: 'api-detail', id: hash.slice(6) }
  return { page: 'dashboard' }
}

export function navigate(path: string) {
  window.location.hash = path
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash)

  useEffect(() => {
    const handler = () => setRoute(parseHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  return (
    <Layout>
      {route.page === 'dashboard' && <Dashboard />}
      {route.page === 'apis' && <ApiList />}
      {route.page === 'api-detail' && <ApiDetail id={route.id} />}
      {route.page === 'api-create' && <ApiCreate />}
    </Layout>
  )
}
