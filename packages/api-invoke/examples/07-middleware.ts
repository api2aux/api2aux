/**
 * 07 — Middleware
 *
 * Compose middleware for logging, tracing, and retry.
 * Note: `withRetry` is a fetch wrapper (passed via `options.fetch`),
 * while `logging` and custom middleware use `options.middleware`.
 * API: HTTPBin (no auth required)
 *
 * Run: npx tsx examples/07-middleware.ts
 */

import { createClient, withRetry, logging } from 'api-invoke'
import type { Middleware } from 'api-invoke'

// --- Custom middleware: request/response tracing ---

const tracing: Middleware = {
  name: 'tracing',
  onRequest(url, init) {
    console.log(`  [tracing] → ${init.method ?? 'GET'} ${url}`)
    return { url, init }
  },
  onResponse(response) {
    console.log(`  [tracing] ← ${response.status} ${response.statusText}`)
    return response
  },
  // onError is observational only — the original error still propagates to the caller.
  onError(error) {
    console.log(`  [tracing] ✗ ${error.message}`)
  },
}

// --- Part A: Logging + custom middleware ---

console.log('--- Logging + custom middleware ---\n')

const logs: string[] = []
const client = await createClient('https://httpbin.org/spec.json', {
  middleware: [
    logging({ log: (msg: string) => logs.push(msg) }),
    tracing,
  ],
})

const result = await client.execute('get_get')
console.log(`\n  Status: ${result.status}`)
console.log(`  Log entries: ${logs.length}`)

// --- Part B: Retry (fetch wrapper) ---

console.log('\n--- withRetry (fetch wrapper) ---\n')

const retryClient = await createClient('https://httpbin.org/spec.json', {
  fetch: withRetry({
    maxRetries: 2,
    initialDelayMs: 500,
    onRetry(attempt, delayMs, status) {
      console.log(`  [retry] attempt ${attempt}, delay ${delayMs}ms, status ${status}`)
    },
  }),
  middleware: [tracing], // middleware and retry can be combined
})

const retryResult = await retryClient.execute('get_get')
console.log(`\n  Status: ${retryResult.status} (no retries needed for 200)`)
