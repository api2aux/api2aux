/**
 * 02 — Raw URL (Tier 3: No spec needed)
 *
 * Call any URL without an OpenAPI spec. Shows both `executeRaw` (one-shot)
 * and `createClient` with a plain URL (query params become operation params).
 * API: JSONPlaceholder (no auth required)
 *
 * Run: npx tsx examples/02-raw-url.ts
 */

import { createClient, executeRaw } from 'api-invoke'

// --- Part A: One-shot with executeRaw ---

console.log('--- executeRaw (one-shot) ---\n')

const result = await executeRaw('https://jsonplaceholder.typicode.com/posts/1')
console.log(`Status: ${result.status} (${result.elapsedMs}ms)`)
console.log('Data:', result.data)

// --- Part B: Client from a raw URL ---

console.log('\n--- createClient from raw URL ---\n')

const client = await createClient(
  'https://jsonplaceholder.typicode.com/todos?userId=1&completed=true',
)

// Query params from the URL become configurable operation parameters
console.log(`Operations: ${client.operations.map(o => o.id).join(', ')}`)
console.log(`Parameters: ${client.operations[0].parameters.map(p => p.name).join(', ')}\n`)

// Execute with URL defaults
const todos = await client.execute('get_todos')
console.log(`User 1 completed todos: ${(todos.data as any[]).length}`)

// Override parameters
const user2 = await client.execute('get_todos', { userId: '2' })
console.log(`User 2 completed todos: ${(user2.data as any[]).length}`)
