/// <reference types="node" />
/**
 * 08 — Streaming / SSE
 *
 * Defines Wikimedia's EventStreams API with defineAPI, creates a client,
 * and streams real-time Wikipedia edits via client.executeStream().
 * No API keys needed — this is a public SSE endpoint.
 *
 * Run: npx tsx examples/08-streaming.ts
 */

import { ApiInvokeClient, defineAPI } from 'api-invoke'

// Define the Wikimedia EventStreams API
const api = defineAPI('Wikimedia EventStreams')
  .baseUrl('https://stream.wikimedia.org')
  .get('/v2/stream/recentchange', { id: 'recentChanges' })
  .build()

const client = new ApiInvokeClient(api)

console.log(`API: ${client.api.title}`)
console.log(`Operations: ${client.operations.map(o => o.id).join(', ')}\n`)

const result = await client.executeStream('recentChanges')

console.log(`Status: ${result.status}`)
console.log('Streaming live Wikipedia edits...\n')

let count = 0
for await (const event of result.stream) {
  let change
  try {
    change = JSON.parse(event.data)
  } catch {
    console.debug(`[skipped non-JSON event] ${event.data.slice(0, 80)}`)
    continue
  }
  const { wiki, title, user, type } = change
  console.log(`[${wiki}] ${type}: "${title}" by ${user}`)

  if (++count >= 10) break // Show 10 edits then stop
}

console.log('\nDone! (showed 10 of the continuous stream)')
