/**
 * 01 — Quick Start (Tier 1: High-level client)
 *
 * Parse an OpenAPI spec, discover operations, and execute a call.
 * API: Cleveland Museum of Art (no auth required)
 *
 * Run: npx tsx examples/01-quick-start.ts
 */

import { createClient } from 'api-invoke'

const client = await createClient('https://openaccess-api.clevelandart.org/openapi.json')

console.log(`API: ${client.api.title}`)
console.log(`Base URL: ${client.api.baseUrl}`)
console.log(`Operations: ${client.operations.length}\n`)

// Search for Monet artworks
const result = await client.execute('get_artworks_api_artworks_get', {
  q: 'monet',
  limit: 3,
})

console.log(`Status: ${result.status} (${result.elapsedMs}ms)\n`)

const artworks = (result.data as any)?.data ?? []
for (const art of artworks) {
  console.log(`  "${art.title}" (${art.creation_date ?? 'unknown date'}) — ${art.type}`)
}
