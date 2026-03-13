/**
 * Drizzle schema for the API catalog database.
 * Works with SQLite (local dev), D1 (Cloudflare), or Postgres (with driver swap).
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ── apis — core catalog table ─────────────────────────────────────────

export const apis = sqliteTable('apis', {
  id: text('id').primaryKey(),  // slug, e.g. "openweathermap"
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  subcategory: text('subcategory'),
  baseUrl: text('base_url').notNull(),
  documentationUrl: text('documentation_url'),
  openapiSpecUrl: text('openapi_spec_url'),
  authType: text('auth_type').notNull().default('none'),
  freeTier: text('free_tier'),
  rateLimits: text('rate_limits'),
  responseFormat: text('response_format'),
  httpMethods: text('http_methods'),
  status: text('status').notNull().default('active'),
  countryRegion: text('country_region'),
  pricingUrl: text('pricing_url'),
  corsSupport: text('cors_support'),
  logoUrl: text('logo_url'),
  openapiVersion: text('openapi_version'),
  apiVersion: text('api_version'),
  contactUrl: text('contact_url'),
  contactEmail: text('contact_email'),
  source: text('source'),
  hasSpec: integer('has_spec').notNull().default(0),
  specFile: text('spec_file'),
  endpointCount: integer('endpoint_count').default(0),
  specFormat: text('spec_format'),
  specParsed: integer('spec_parsed').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  deletedAt: text('deleted_at'),
})

// ── api_operations — parsed operations (lazy-filled) ──────────────────

export const apiOperations = sqliteTable('api_operations', {
  id: text('id').primaryKey(),
  apiId: text('api_id').notNull().references(() => apis.id),
  operationId: text('operation_id').notNull(),
  method: text('method').notNull(),
  path: text('path').notNull(),
  summary: text('summary'),
  description: text('description'),
  tags: text('tags'),           // JSON array
  parameters: text('parameters'), // JSON (serialized params)
  requestBody: text('request_body'), // JSON (serialized request body schema)
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// ── sync_log — track what's been synced to mcp-worker ─────────────────

export const syncLog = sqliteTable('sync_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  apiId: text('api_id').notNull().references(() => apis.id),
  action: text('action').notNull(),  // created, updated, deleted
  syncedAt: text('synced_at'),
  syncStatus: text('sync_status').notNull().default('pending'),
  error: text('error'),
})
