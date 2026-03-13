/**
 * No-op SyncTarget for local development.
 * Logs sync operations to console without writing anywhere.
 */

import type { SyncTarget, CatalogIndexEntry } from '../types'

export class MemorySyncTarget implements SyncTarget {
  async put(key: string, _config: unknown): Promise<void> {
    console.log(`[sync] put ${key}`)
  }

  async delete(key: string): Promise<void> {
    console.log(`[sync] delete ${key}`)
  }

  async putIndex(index: CatalogIndexEntry[]): Promise<void> {
    console.log(`[sync] putIndex (${index.length} entries)`)
  }
}
