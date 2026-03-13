const BASE = '/api'

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: '' })) as { error?: string }
    throw new Error(body.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface Api {
  id: string
  name: string
  description: string | null
  category: string
  subcategory: string | null
  baseUrl: string
  documentationUrl: string | null
  openapiSpecUrl: string | null
  authType: string
  freeTier: string | null
  rateLimits: string | null
  responseFormat: string | null
  httpMethods: string | null
  status: string
  countryRegion: string | null
  pricingUrl: string | null
  corsSupport: string | null
  logoUrl: string | null
  openapiVersion: string | null
  apiVersion: string | null
  contactUrl: string | null
  contactEmail: string | null
  source: string | null
  hasSpec: number
  specFile: string | null
  endpointCount: number | null
  specFormat: string | null
  specParsed: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface ApiDetail extends Api {
  operations: Operation[]
}

export interface Operation {
  id: string
  apiId: string
  operationId: string
  method: string
  path: string
  summary: string | null
  description: string | null
  tags: string | null
  parameters: string | null
  requestBody: string | null
  createdAt: string
}

export interface SearchResult {
  items: Api[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface FacetEntry { value: string; count: number }
export interface Facets {
  categories: FacetEntry[]
  authTypes: FacetEntry[]
  freeTiers: FacetEntry[]
  statuses: FacetEntry[]
}

export const api = {
  search(params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString()
    return request<SearchResult>(`/apis?${qs}`)
  },
  facets() {
    return request<Facets>('/apis/facets')
  },
  getById(id: string) {
    return request<ApiDetail>(`/apis/${id}`)
  },
  create(body: Record<string, unknown>) {
    return request<Api>('/apis', { method: 'POST', body: JSON.stringify(body) })
  },
  update(id: string, body: Record<string, unknown>) {
    return request<Api>(`/apis/${id}`, { method: 'PUT', body: JSON.stringify(body) })
  },
  delete(id: string) {
    return request<{ deleted: string }>(`/apis/${id}`, { method: 'DELETE' })
  },
  sync() {
    return request<{ synced: number; failed: number }>('/sync', { method: 'POST' })
  },
}
