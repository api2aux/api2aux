/**
 * 06 — Error Handling
 *
 * HTTP errors are thrown as ApiInvokeError with a `kind` for programmatic
 * handling, a `suggestion` for humans, and a `retryable` flag.
 * Other errors (e.g. unknown operation) use standard Error.
 * API: HTTPBin (no auth required, Swagger 2.0)
 *
 * Run: npx tsx examples/06-error-handling.ts
 */

import { createClient, ApiInvokeError } from 'api-invoke'

const client = await createClient('https://httpbin.org/spec.json')

// --- Part A: Catching classified errors ---

console.log('--- Classified errors ---\n')

async function tryStatus(code: number) {
  try {
    await client.execute('get_status_codes', { codes: String(code) })
  } catch (err) {
    if (err instanceof ApiInvokeError) {
      console.log(`  ${code} → kind: ${err.kind}, retryable: ${err.retryable}`)
      console.log(`         suggestion: ${err.suggestion}`)
    } else {
      throw err
    }
  }
}

await tryStatus(401) // AUTH error
await tryStatus(403) // AUTH error
await tryStatus(404) // HTTP error
await tryStatus(429) // RATE_LIMIT error
await tryStatus(500) // HTTP error (retryable)

// --- Part B: Unknown operation ---

console.log('\n--- Unknown operation ---\n')

try {
  // execute() throws a plain Error (not ApiInvokeError) for unknown operations
  await client.execute('nonexistent_operation')
} catch (err) {
  console.log(`  Error: ${err instanceof Error ? err.message : String(err)}`)
}

// --- Part C: Non-throwing mode ---

console.log('\n--- Non-throwing mode (throwOnHttpError: false) ---\n')

const result = await client.execute('get_status_codes', { codes: '404' }, {
  throwOnHttpError: false,
})

console.log(`  Status: ${result.status}`)
console.log(`  Error kind: ${result.errorKind ?? 'none'}`)
console.log(`  Data available: ${result.data !== undefined}`)
