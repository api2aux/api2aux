/**
 * Business logic for API catalog operations.
 * Sits between routes (HTTP) and repository (DB).
 */

import { ApiRepository } from '../repositories/api-repository'
import type { ApiRecord, ApiInsert } from '../repositories/api-repository'

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
  items: ApiRecord[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface CreateApiInput {
  id: string
  name: string
  category: string
  baseUrl: string
  [key: string]: unknown
}

export class ApiService {
  private readonly repo: ApiRepository
  constructor(repo: ApiRepository) {
    this.repo = repo
  }

  search(params: SearchParams): SearchResult {
    const page = params.page ?? 1
    const limit = Math.min(params.limit ?? 20, 100)
    const offset = (page - 1) * limit

    const { items, total } = this.repo.search(
      {
        category: params.category,
        subcategory: params.subcategory,
        authType: params.authType,
        freeTier: params.freeTier,
        corsSupport: params.corsSupport,
        hasSpec: params.hasSpec === 'true' ? true : params.hasSpec === 'false' ? false : null,
        status: params.status,
        textPattern: params.q ? `%${params.q}%` : undefined,
      },
      limit,
      offset,
    )

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) }
  }

  facets() {
    return this.repo.facets()
  }

  getById(id: string) {
    const api = this.repo.findById(id)
    if (!api) return null

    const operations = this.repo.findOperationsByApiId(id)
    return { ...api, operations }
  }

  create(input: CreateApiInput): { error: string; status: 409 } | { data: ApiRecord; status: 201 } {
    const existing = this.repo.findById(input.id)
    if (existing) {
      return { error: `API "${input.id}" already exists`, status: 409 }
    }

    const record: ApiInsert = {
      id: input.id,
      name: input.name,
      description: input.description as string | undefined,
      category: input.category,
      subcategory: input.subcategory as string | undefined,
      baseUrl: input.baseUrl,
      documentationUrl: input.documentationUrl as string | undefined,
      openapiSpecUrl: input.openapiSpecUrl as string | undefined,
      authType: (input.authType as string) ?? 'none',
      freeTier: input.freeTier as string | undefined,
      rateLimits: input.rateLimits as string | undefined,
      responseFormat: input.responseFormat as string | undefined,
      httpMethods: input.httpMethods as string | undefined,
      status: (input.status as string) ?? 'active',
      countryRegion: input.countryRegion as string | undefined,
      pricingUrl: input.pricingUrl as string | undefined,
      corsSupport: input.corsSupport as string | undefined,
      logoUrl: input.logoUrl as string | undefined,
      openapiVersion: input.openapiVersion as string | undefined,
      apiVersion: input.apiVersion as string | undefined,
      contactUrl: input.contactUrl as string | undefined,
      contactEmail: input.contactEmail as string | undefined,
      source: (input.source as string) ?? 'manual',
    }

    const created = this.repo.insert(record)!
    return { data: created, status: 201 as const }
  }

  update(id: string, input: Record<string, unknown>) {
    const existing = this.repo.findById(id)
    if (!existing) return null

    // Strip fields that shouldn't be updated directly
    delete input.id
    delete input.createdAt

    return this.repo.update(id, input)
  }

  delete(id: string): boolean {
    const existing = this.repo.findById(id)
    if (!existing) return false

    this.repo.softDelete(id)
    return true
  }
}
