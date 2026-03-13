/**
 * Sync service — pushes catalog changes to the mcp-worker's runtime store.
 *
 * On create/update/delete of an API, a sync_log entry is written.
 * syncPending() reads unsynced entries and pushes them to the SyncTarget.
 */

import { eq, sql } from 'drizzle-orm'
import { apis, apiOperations, syncLog } from '../db/schema'
import type { Database, SyncTarget, CatalogIndexEntry } from '../types'

export class SyncService {
  private readonly db: Database
  private readonly syncTarget: SyncTarget

  constructor(db: Database, syncTarget: SyncTarget) {
    this.db = db
    this.syncTarget = syncTarget
  }

  /** Record a sync action for an API (called after CRUD operations) */
  logAction(apiId: string, action: 'created' | 'updated' | 'deleted') {
    this.db.insert(syncLog).values({ apiId, action }).run()
  }

  /** Process all pending sync_log entries and push to the SyncTarget */
  async syncPending(): Promise<{ synced: number; failed: number }> {
    const pending = this.db
      .select()
      .from(syncLog)
      .where(eq(syncLog.syncStatus, 'pending'))
      .orderBy(syncLog.id)
      .all()

    if (pending.length === 0) return { synced: 0, failed: 0 }

    let synced = 0
    let failed = 0

    for (const entry of pending) {
      try {
        if (entry.action === 'deleted') {
          await this.syncTarget.delete(entry.apiId)
        } else {
          // Build config from current API state
          const api = this.db.select().from(apis).where(eq(apis.id, entry.apiId)).get()
          if (api && !api.deletedAt) {
            const operations = this.db
              .select()
              .from(apiOperations)
              .where(eq(apiOperations.apiId, entry.apiId))
              .all()

            await this.syncTarget.put(entry.apiId, {
              apiUrl: api.baseUrl,
              baseUrl: api.baseUrl,
              name: api.id,
              authType: api.authType,
              operations: operations.map(op => ({
                id: op.operationId,
                method: op.method,
                path: op.path,
                summary: op.summary || '',
                description: op.description || '',
                tags: op.tags ? JSON.parse(op.tags) : [],
                parameters: op.parameters ? JSON.parse(op.parameters) : [],
                requestBody: op.requestBody ? JSON.parse(op.requestBody) : undefined,
              })),
              createdAt: api.createdAt,
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            })
          }
        }

        // Mark as synced
        this.db.update(syncLog)
          .set({ syncStatus: 'synced', syncedAt: sql`(datetime('now'))` })
          .where(eq(syncLog.id, entry.id))
          .run()
        synced++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.db.update(syncLog)
          .set({ syncStatus: 'failed', error: message })
          .where(eq(syncLog.id, entry.id))
          .run()
        failed++
      }
    }

    // Rebuild catalog index after processing
    await this.rebuildIndex()

    return { synced, failed }
  }

  /** Rebuild and push the full catalog index to the SyncTarget */
  async rebuildIndex(): Promise<void> {
    const allApis = this.db
      .select()
      .from(apis)
      .where(sql`${apis.deletedAt} IS NULL AND ${apis.status} = 'active'`)
      .orderBy(apis.name)
      .all()

    const index: CatalogIndexEntry[] = allApis.map(api => ({
      name: api.id,
      description: api.description || api.name,
      category: api.category,
      auth: api.authType,
      mcpUrl: '', // Populated by the consumer based on its own origin
    }))

    await this.syncTarget.putIndex(index)
  }
}
