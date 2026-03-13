/**
 * Faceted search logic for the API catalog.
 * Uses Drizzle SQL + SQLite FTS5 for text search.
 */

import { eq, and, like, isNull, sql, count } from 'drizzle-orm'
import { apis } from '../db/schema'
import type { Database } from '../types'

export interface SearchParams {
  q?: string
  category?: string
  subcategory?: string
  authType?: string
  freeTier?: string
  corsSupport?: string
  hasSpec?: string
  status?: string
  page?: number
  limit?: number
}

export interface SearchResult {
  items: (typeof apis.$inferSelect)[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface FacetCounts {
  categories: { value: string; count: number }[]
  authTypes: { value: string; count: number }[]
  freeTiers: { value: string; count: number }[]
  statuses: { value: string; count: number }[]
}

/** Build WHERE conditions from search params */
function buildConditions(params: SearchParams) {
  const conditions = []

  // Always exclude soft-deleted
  conditions.push(isNull(apis.deletedAt))

  if (params.category) {
    conditions.push(eq(apis.category, params.category))
  }
  if (params.subcategory) {
    conditions.push(eq(apis.subcategory, params.subcategory))
  }
  if (params.authType) {
    conditions.push(eq(apis.authType, params.authType))
  }
  if (params.freeTier) {
    conditions.push(eq(apis.freeTier, params.freeTier))
  }
  if (params.corsSupport) {
    conditions.push(eq(apis.corsSupport, params.corsSupport))
  }
  if (params.hasSpec === 'true') {
    conditions.push(eq(apis.hasSpec, 1))
  } else if (params.hasSpec === 'false') {
    conditions.push(eq(apis.hasSpec, 0))
  }
  if (params.status) {
    conditions.push(eq(apis.status, params.status))
  }
  if (params.q) {
    // Simple LIKE search — FTS5 virtual table added later for performance
    const pattern = `%${params.q}%`
    conditions.push(
      sql`(${apis.name} LIKE ${pattern} OR ${apis.description} LIKE ${pattern})`
    )
  }

  return conditions
}

export function searchApis(db: Database, params: SearchParams): SearchResult {
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 100)
  const offset = (page - 1) * limit
  const conditions = buildConditions(params)

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const items = db
    .select()
    .from(apis)
    .where(where)
    .limit(limit)
    .offset(offset)
    .orderBy(apis.name)
    .all()

  const totalResult = db
    .select({ count: count() })
    .from(apis)
    .where(where)
    .get()

  const total = totalResult?.count ?? 0

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

export function getFacets(db: Database): FacetCounts {
  const activeFilter = isNull(apis.deletedAt)

  const categories = db
    .select({ value: apis.category, count: count() })
    .from(apis)
    .where(activeFilter)
    .groupBy(apis.category)
    .orderBy(sql`count(*) DESC`)
    .all()

  const authTypes = db
    .select({ value: apis.authType, count: count() })
    .from(apis)
    .where(activeFilter)
    .groupBy(apis.authType)
    .orderBy(sql`count(*) DESC`)
    .all()

  const freeTiers = db
    .select({ value: apis.freeTier, count: count() })
    .from(apis)
    .where(and(activeFilter, sql`${apis.freeTier} IS NOT NULL`))
    .groupBy(apis.freeTier)
    .orderBy(sql`count(*) DESC`)
    .all()

  const statuses = db
    .select({ value: apis.status, count: count() })
    .from(apis)
    .where(activeFilter)
    .groupBy(apis.status)
    .orderBy(sql`count(*) DESC`)
    .all()

  return {
    categories,
    authTypes,
    freeTiers: freeTiers as { value: string; count: number }[],
    statuses,
  }
}
