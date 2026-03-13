/**
 * Cloud-agnostic interfaces for the API catalog.
 * Concrete implementations live in the deploy repo (Cloudflare, AWS, etc.)
 * or in local dev stores within this package.
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from './db/schema'

// ── Database ──────────────────────────────────────────────────────────

/** Drizzle database instance — works with SQLite file, D1, or Postgres */
export type Database = BetterSQLite3Database<typeof schema>

// ── Spec file storage ─────────────────────────────────────────────────

/** Abstract spec file storage (local filesystem, R2, S3, etc.) */
export interface SpecStore {
  get(key: string): Promise<ArrayBuffer | null>
  put(key: string, data: ArrayBuffer): Promise<void>
  delete(key: string): Promise<void>
  list(): Promise<string[]>
}

// ── Sync target ───────────────────────────────────────────────────────

/** Lightweight catalog index entry pushed to the mcp-worker */
export interface CatalogIndexEntry {
  name: string
  description: string
  category: string
  auth: string
  mcpUrl: string
}

/** Target for syncing catalog data to the mcp-worker's runtime store */
export interface SyncTarget {
  put(key: string, config: unknown): Promise<void>
  delete(key: string): Promise<void>
  putIndex(index: CatalogIndexEntry[]): Promise<void>
}

// ── App dependencies ──────────────────────────────────────────────────

/** Dependencies injected into the Hono app factory */
export interface AppDeps {
  db: Database
  specStore: SpecStore
  syncTarget: SyncTarget
}

/** Hono env with injected dependencies */
export type AppEnv = {
  Variables: {
    deps: AppDeps
  }
}
