/**
 * Lazy spec parser — resolves OpenAPI specs on first access.
 *
 * When get_api_details is called for an API with has_spec=true but
 * spec_parsed=false, this service:
 * 1. Fetches the spec from SpecStore
 * 2. Parses it into operations
 * 3. Stores parsed operations in the api_operations table
 * 4. Marks spec_parsed=true on the API
 */

import { eq, sql } from 'drizzle-orm'
import { apis, apiOperations } from '../db/schema'
import type { Database, SpecStore } from '../types'

export interface ResolveResult {
  ok: boolean
  error?: string
  operationCount?: number
}

export class SpecResolver {
  private readonly db: Database
  private readonly specStore: SpecStore

  constructor(db: Database, specStore: SpecStore) {
    this.db = db
    this.specStore = specStore
  }

  async resolve(apiId: string): Promise<ResolveResult> {
    const api = this.db.select().from(apis).where(eq(apis.id, apiId)).get()
    if (!api) return { ok: false, error: 'API not found' }
    if (!api.specFile) return { ok: false, error: 'No spec file configured' }
    if (api.specParsed === 1) return { ok: true, operationCount: 0 }

    try {
      const specData = await this.specStore.get(api.specFile)
      if (!specData) return { ok: false, error: `Spec file "${api.specFile}" not found in store` }

      const specText = new TextDecoder().decode(specData)
      let specObject: object

      try {
        specObject = JSON.parse(specText)
      } catch {
        // Try YAML — for now just handle JSON specs
        return { ok: false, error: 'Spec is not valid JSON (YAML parsing not yet supported)' }
      }

      // Dynamic import to avoid hard dependency on api-invoke at module level
      const { parseOpenAPISpec } = await import('@api2aux/api-invoke')
      const parsed = await parseOpenAPISpec(specObject)

      // Store operations
      let count = 0
      for (const op of parsed.operations) {
        this.db.insert(apiOperations).values({
          id: `${apiId}:${op.method.toLowerCase()}:${op.path}`,
          apiId,
          operationId: op.id || `${op.method}_${op.path.replace(/\//g, '_')}`,
          method: op.method,
          path: op.path,
          summary: op.summary || null,
          description: op.description || null,
          tags: op.tags?.length ? JSON.stringify(op.tags) : null,
          parameters: op.parameters?.length ? JSON.stringify(op.parameters) : null,
          requestBody: op.requestBody ? JSON.stringify(op.requestBody) : null,
        }).run()
        count++
      }

      // Mark as parsed and update metadata
      this.db.update(apis)
        .set({
          specParsed: 1,
          endpointCount: count,
          specFormat: parsed.specFormat || null,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(apis.id, apiId))
        .run()

      return { ok: true, operationCount: count }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[spec-resolver] Failed to parse spec for ${apiId}:`, message)
      return { ok: false, error: `Parse failed: ${message}` }
    }
  }
}
