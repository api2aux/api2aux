/**
 * CSV ingestion script — imports APIs from data/apis.csv into the catalog database.
 *
 * Usage: pnpm --filter @api2aux/api-catalog ingest
 *
 * 1. Parses data/apis.csv (skips double header row)
 * 2. Generates deterministic slugs from API names
 * 3. Cross-references data/specs/index.json for spec metadata
 * 4. Applies exclusion list from data/catalog-exclude.json
 * 5. Upserts into local SQLite via Drizzle
 * 6. Logs summary
 */

import { parse } from 'csv-parse/sync'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import * as schema from '../src/db/schema'
import { apis } from '../src/db/schema'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../../data')
const pkgDir = path.resolve(__dirname, '..')

// ── Helpers ───────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface ExclusionEntry {
  slug: string
  reason: string
}

interface ExclusionData {
  excluded: ExclusionEntry[]
  overrides: Record<string, Record<string, string>>
}

interface SpecEntry {
  file: string
  url: string
  size_bytes: number
  endpoint_count: number
  spec_format: string
  api_version: string
}

// ── Load data sources ─────────────────────────────────────────────────

// CSV
const csvPath = path.join(dataDir, 'apis.csv')
if (!existsSync(csvPath)) {
  console.error(`CSV file not found: ${csvPath}`)
  process.exit(1)
}
const csvContent = readFileSync(csvPath, 'utf-8')

// Parse CSV — skip the first "column 1, column 2, ..." header row
const records: string[][] = parse(csvContent, {
  relax_column_count: true,
  skip_empty_lines: true,
})

// Row 0 = "column 1", "column 2", ... (skip)
// Row 1 = actual headers
// Row 2+ = data
const headers = records[1]!
const dataRows = records.slice(2)

console.log(`CSV: ${dataRows.length} APIs, ${headers.length} columns`)
console.log(`Headers: ${headers.join(', ')}`)

// Specs index
const specsIndexPath = path.join(dataDir, 'specs/index.json')
let specsIndex: Record<string, SpecEntry> = {}
if (existsSync(specsIndexPath)) {
  const specsData = JSON.parse(readFileSync(specsIndexPath, 'utf-8'))
  specsIndex = specsData.specs ?? {}
  console.log(`Specs index: ${Object.keys(specsIndex).length} entries`)
}

// Exclusion list
const excludePath = path.join(dataDir, 'catalog-exclude.json')
let exclusions: ExclusionData = { excluded: [], overrides: {} }
if (existsSync(excludePath)) {
  exclusions = JSON.parse(readFileSync(excludePath, 'utf-8'))
  console.log(`Exclusions: ${exclusions.excluded.length} excluded APIs`)
}

const excludedSlugs = new Set(exclusions.excluded.map(e => e.slug))

// ── Database setup ────────────────────────────────────────────────────

const sqlite = new Database(path.resolve(pkgDir, 'dev.db'))
sqlite.pragma('journal_mode = WAL')
const db = drizzle(sqlite, { schema })

migrate(db, { migrationsFolder: path.resolve(pkgDir, 'src/db/migrations') })

// ── Build column index ────────────────────────────────────────────────

const colIndex: Record<string, number> = {}
for (let i = 0; i < headers.length; i++) {
  colIndex[headers[i]!] = i
}

function col(row: string[], name: string): string | undefined {
  const idx = colIndex[name]
  if (idx === undefined) return undefined
  const val = row[idx]?.trim()
  return val === '' ? undefined : val
}

// ── Process rows ──────────────────────────────────────────────────────

let imported = 0
let skippedExcluded = 0
let skippedDuplicate = 0
const categoryCounts: Record<string, number> = {}
const authCounts: Record<string, number> = {}

for (const row of dataRows) {
  const name = col(row, 'name')
  if (!name) continue

  const slug = slugify(name)

  // Skip excluded
  if (excludedSlugs.has(slug)) {
    skippedExcluded++
    continue
  }

  const category = col(row, 'category') ?? 'Uncategorized'
  const authType = col(row, 'auth_type') ?? 'none'

  // Look up spec info
  const specEntry = specsIndex[name]
  const hasSpec = specEntry ? 1 : 0
  const specFile = specEntry ? `specs/${specEntry.file}` : undefined
  const endpointCount = specEntry?.endpoint_count ?? 0
  const specFormat = specEntry?.spec_format || undefined

  // Apply overrides
  const overrides = exclusions.overrides[slug] ?? {}

  const record = {
    id: slug,
    name,
    description: col(row, 'description'),
    category,
    subcategory: col(row, 'subcategory'),
    baseUrl: col(row, 'base_url') ?? `https://${slug}.example.com`,
    documentationUrl: col(row, 'documentation_url'),
    openapiSpecUrl: col(row, 'openapi_spec_url'),
    authType: overrides.authType ?? authType,
    freeTier: col(row, 'free_tier'),
    rateLimits: col(row, 'rate_limits'),
    responseFormat: col(row, 'response_format'),
    httpMethods: col(row, 'http_methods'),
    status: col(row, 'status') ?? 'active',
    countryRegion: col(row, 'country_region'),
    pricingUrl: col(row, 'pricing_url'),
    corsSupport: col(row, 'cors_support'),
    logoUrl: col(row, 'logo_url'),
    openapiVersion: col(row, 'openapi_version'),
    apiVersion: col(row, 'api_version'),
    contactUrl: col(row, 'contact_url'),
    contactEmail: col(row, 'contact_email'),
    source: col(row, 'source') ?? 'csv-import',
    hasSpec,
    specFile,
    endpointCount,
    specFormat,
  }

  // Upsert: try insert, update on conflict
  const existing = db.select().from(apis).where(eq(apis.id, slug)).get()
  if (existing) {
    db.update(apis)
      .set({ ...record, updatedAt: new Date().toISOString() })
      .where(eq(apis.id, slug))
      .run()
    skippedDuplicate++
  } else {
    db.insert(apis).values(record).run()
  }

  imported++
  categoryCounts[category] = (categoryCounts[category] ?? 0) + 1
  authCounts[authType] = (authCounts[authType] ?? 0) + 1
}

// ── Summary ───────────────────────────────────────────────────────────

console.log('\n=== Ingestion Summary ===')
console.log(`Total imported: ${imported}`)
console.log(`Skipped (excluded): ${skippedExcluded}`)
console.log(`Updated (duplicate slug): ${skippedDuplicate}`)

console.log('\nBy category:')
for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${count}`)
}

console.log('\nBy auth type:')
for (const [auth, count] of Object.entries(authCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${auth}: ${count}`)
}

console.log(`\nWith specs: ${Object.values(categoryCounts).length > 0 ? dataRows.filter(r => specsIndex[col(r, 'name') ?? '']).length : 0}`)

sqlite.close()
console.log('\nDone.')
