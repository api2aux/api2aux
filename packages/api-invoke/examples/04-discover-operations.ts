/**
 * 04 — Discover Operations
 *
 * Explore what an API offers before calling it: operations, parameters,
 * HTTP methods, and auth schemes.
 * API: National Weather Service (no auth required, many operations)
 *
 * Run: npx tsx examples/04-discover-operations.ts
 */

import { createClient } from 'api-invoke'

const client = await createClient('https://api.weather.gov/openapi.json')

console.log(`API: ${client.api.title}`)
console.log(`Base URL: ${client.api.baseUrl}`)
console.log(`Total operations: ${client.operations.length}\n`)

// Group operations by HTTP method
const byMethod: Record<string, number> = {}
for (const op of client.operations) {
  const m = op.method.toUpperCase()
  byMethod[m] = (byMethod[m] ?? 0) + 1
}
console.log('By method:', Object.entries(byMethod).map(([m, n]) => `${m}: ${n}`).join(', '))

// Show first 10 operations
console.log('\nFirst 10 operations:')
console.log(`  ${'Method'.padEnd(8)} ${'Path'.padEnd(35)} Params`)
for (const op of client.operations.slice(0, 10)) {
  console.log(`  ${op.method.toUpperCase().padEnd(8)} ${op.path.padEnd(35)} ${op.parameters.length}`)
}

// Inspect one operation in detail
const alertsOp = client.operations.find(
  o => o.method.toLowerCase() === 'get' && o.path === '/alerts',
)
if (!alertsOp) {
  console.error('Could not find GET /alerts operation in the spec.')
  process.exit(1)
}

console.log(`\nDetailed: ${alertsOp.id}`)
console.log(`  ${alertsOp.method.toUpperCase()} ${alertsOp.path}`)
console.log(`  Summary: ${alertsOp.summary ?? '(none)'}`)
console.log(`  Parameters (${alertsOp.parameters.length}):`)
for (const p of alertsOp.parameters.slice(0, 5)) {
  console.log(`    - ${p.name} (${p.in}, ${p.required ? 'required' : 'optional'})`)
}
if (alertsOp.parameters.length > 5) {
  console.log(`    ... and ${alertsOp.parameters.length - 5} more`)
}

// Auth schemes
console.log(`\nAuth schemes: ${client.authSchemes.length === 0 ? 'none (public API)' : client.authSchemes.map(s => s.authType).join(', ')}`)
