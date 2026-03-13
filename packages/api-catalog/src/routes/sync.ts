/**
 * Sync routes — trigger and monitor sync to mcp-worker.
 */

import { Hono } from 'hono'
import { SyncService } from '../services/sync'
import { requireAuth } from '../middleware/auth'
import type { AppEnv } from '../types'

const syncRouter = new Hono<AppEnv>()

/** POST /api/sync — process all pending sync entries (protected) */
syncRouter.post('/api/sync', requireAuth, async (c) => {
  const { db, syncTarget } = c.get('deps')
  const sync = new SyncService(db, syncTarget)
  const result = await sync.syncPending()
  return c.json(result)
})

/** POST /api/sync/index — rebuild and push the full catalog index (protected) */
syncRouter.post('/api/sync/index', requireAuth, async (c) => {
  const { db, syncTarget } = c.get('deps')
  const sync = new SyncService(db, syncTarget)
  await sync.rebuildIndex()
  return c.json({ ok: true })
})

export { syncRouter }
