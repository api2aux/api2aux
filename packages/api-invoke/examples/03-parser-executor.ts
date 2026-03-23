/**
 * 03 — Parser + Executor (Tier 2: More control)
 *
 * Use the parser and executor separately to inspect and transform
 * the parsed API before executing operations.
 * API: Postcodes.io (YAML spec, no auth required)
 *
 * Run: npx tsx examples/03-parser-executor.ts
 */

import { parseOpenAPISpec, executeOperation } from 'api-invoke'

// Parse a YAML spec (JSON works too)
const api = await parseOpenAPISpec('https://postcodes.io/openapi.yaml')

console.log(`API: ${api.title}`)
console.log(`Base URL: ${api.baseUrl}`)
console.log(`Format: ${api.specFormat}`)
console.log(`Operations: ${api.operations.length}\n`)

// Find the postcode lookup operation
const lookupOp = api.operations.find(
  o => o.method.toLowerCase() === 'get' && o.path.includes('/postcodes/') && o.path.includes('{'),
)
if (!lookupOp) {
  console.error('Could not find a GET /postcodes/{...} operation in the spec.')
  process.exit(1)
}

console.log(`Using operation: ${lookupOp.id}`)
console.log(`  ${lookupOp.method} ${lookupOp.path}`)
console.log(`  Parameters: ${lookupOp.parameters.map(p => p.name).join(', ')}\n`)

// Execute directly with the executor
const result = await executeOperation(api.baseUrl, lookupOp, { postcode: 'SW1A 1AA' })

const data = result.data as any
console.log(`Postcode: SW1A 1AA`)
console.log(`  Country: ${data.result.country}`)
console.log(`  Region: ${data.result.region}`)
console.log(`  Constituency: ${data.result.parliamentary_constituency}`)
console.log(`  (${result.elapsedMs}ms)`)
