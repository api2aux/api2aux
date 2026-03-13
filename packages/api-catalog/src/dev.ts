/**
 * Local dev entry point.
 * Wires SQLite file + local spec store + memory sync target → createApp().
 */

import { serve } from '@hono/node-server'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './db/schema'
import { createApp } from './index'
import { LocalSpecStore } from './stores/local-spec-store'
import { MemorySyncTarget } from './stores/memory-sync-target'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// SQLite database file
const sqlite = new Database(path.resolve(__dirname, '../dev.db'))
sqlite.pragma('journal_mode = WAL')
const db = drizzle(sqlite, { schema })

// Run migrations
migrate(db, { migrationsFolder: path.resolve(__dirname, './db/migrations') })

// Dev stores
const specStore = new LocalSpecStore(path.resolve(__dirname, '../../../data/specs'))
const syncTarget = new MemorySyncTarget()

const app = createApp({ db, specStore, syncTarget })

const port = parseInt(process.env.PORT || '8788', 10)

console.log(`API Catalog running on http://localhost:${port}`)
serve({ fetch: app.fetch, port })
