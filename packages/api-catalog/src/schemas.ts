/**
 * Zod schemas for OpenAPI route definitions.
 * Used by @hono/zod-openapi to generate the OpenAPI spec automatically.
 */

import { z } from '@hono/zod-openapi'

// ── API record schema (response) ──────────────────────────────────────

export const ApiSchema = z.object({
  id: z.string().openapi({ example: 'openweathermap' }),
  name: z.string().openapi({ example: 'OpenWeatherMap' }),
  description: z.string().nullable().openapi({ example: 'Weather data API' }),
  category: z.string().openapi({ example: 'Weather' }),
  subcategory: z.string().nullable(),
  baseUrl: z.string().url().openapi({ example: 'https://api.openweathermap.org' }),
  documentationUrl: z.string().nullable(),
  openapiSpecUrl: z.string().nullable(),
  authType: z.string().openapi({ example: 'apiKey' }),
  freeTier: z.string().nullable(),
  rateLimits: z.string().nullable(),
  responseFormat: z.string().nullable(),
  httpMethods: z.string().nullable(),
  status: z.string().openapi({ example: 'active' }),
  countryRegion: z.string().nullable(),
  pricingUrl: z.string().nullable(),
  corsSupport: z.string().nullable(),
  logoUrl: z.string().nullable(),
  openapiVersion: z.string().nullable(),
  apiVersion: z.string().nullable(),
  contactUrl: z.string().nullable(),
  contactEmail: z.string().nullable(),
  source: z.string().nullable(),
  hasSpec: z.number().openapi({ example: 1 }),
  specFile: z.string().nullable(),
  endpointCount: z.number().nullable(),
  specFormat: z.string().nullable(),
  specParsed: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
}).openapi('Api')

// ── Operation schema (nested in API detail) ───────────────────────────

export const OperationSchema = z.object({
  id: z.string(),
  apiId: z.string(),
  operationId: z.string(),
  method: z.string().openapi({ example: 'GET' }),
  path: z.string().openapi({ example: '/users/{id}' }),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  tags: z.string().nullable(),
  parameters: z.string().nullable(),
  requestBody: z.string().nullable(),
  createdAt: z.string(),
}).openapi('Operation')

// ── API detail (with operations) ──────────────────────────────────────

export const ApiDetailSchema = ApiSchema.extend({
  operations: z.array(OperationSchema),
}).openapi('ApiDetail')

// ── Search/list response ──────────────────────────────────────────────

export const SearchResultSchema = z.object({
  items: z.array(ApiSchema),
  total: z.number().openapi({ example: 574 }),
  page: z.number().openapi({ example: 1 }),
  limit: z.number().openapi({ example: 20 }),
  totalPages: z.number().openapi({ example: 29 }),
}).openapi('SearchResult')

// ── Search query params ───────────────────────────────────────────────

export const SearchQuerySchema = z.object({
  q: z.string().optional().openapi({ example: 'weather', description: 'Text search (name, description)' }),
  category: z.string().optional().openapi({ description: 'Filter by category' }),
  subcategory: z.string().optional().openapi({ description: 'Filter by subcategory' }),
  authType: z.string().optional().openapi({ description: 'Filter by auth type (none, apiKey, Bearer, OAuth2)' }),
  freeTier: z.string().optional().openapi({ description: 'Filter by free tier (yes, no, freemium)' }),
  corsSupport: z.string().optional().openapi({ description: 'Filter by CORS support' }),
  hasSpec: z.string().optional().openapi({ description: 'Filter by spec availability (true/false)' }),
  status: z.string().optional().openapi({ description: 'Filter by status (active, deprecated, beta, disabled)' }),
  page: z.string().optional().openapi({ example: '1', description: 'Page number (default: 1)' }),
  limit: z.string().optional().openapi({ example: '20', description: 'Items per page (default: 20, max: 100)' }),
}).openapi('SearchQuery')

// ── Facets response ───────────────────────────────────────────────────

const FacetEntrySchema = z.object({
  value: z.string(),
  count: z.number(),
})

export const FacetsSchema = z.object({
  categories: z.array(FacetEntrySchema),
  authTypes: z.array(FacetEntrySchema),
  freeTiers: z.array(FacetEntrySchema),
  statuses: z.array(FacetEntrySchema),
}).openapi('Facets')

// ── Create API request body ───────────────────────────────────────────

export const CreateApiSchema = z.object({
  id: z.string().openapi({ example: 'my-api', description: 'Unique slug identifier' }),
  name: z.string().openapi({ example: 'My API', description: 'Display name' }),
  category: z.string().openapi({ example: 'Data', description: 'Category' }),
  baseUrl: z.string().url().openapi({ example: 'https://api.example.com', description: 'Base URL' }),
  description: z.string().optional(),
  subcategory: z.string().optional(),
  documentationUrl: z.string().optional(),
  openapiSpecUrl: z.string().optional(),
  authType: z.string().optional().openapi({ description: 'Auth type (default: none)' }),
  freeTier: z.string().optional(),
  rateLimits: z.string().optional(),
  responseFormat: z.string().optional(),
  httpMethods: z.string().optional(),
  status: z.string().optional().openapi({ description: 'Status (default: active)' }),
  countryRegion: z.string().optional(),
  pricingUrl: z.string().optional(),
  corsSupport: z.string().optional(),
  logoUrl: z.string().optional(),
  openapiVersion: z.string().optional(),
  apiVersion: z.string().optional(),
  contactUrl: z.string().optional(),
  contactEmail: z.string().optional(),
  source: z.string().optional(),
}).openapi('CreateApi')

// ── Update API request body ───────────────────────────────────────────

export const UpdateApiSchema = CreateApiSchema.partial().omit({ id: true }).openapi('UpdateApi')

// ── Common response schemas ───────────────────────────────────────────

export const ErrorSchema = z.object({
  error: z.string().openapi({ example: 'API not found' }),
}).openapi('Error')

export const DeletedSchema = z.object({
  deleted: z.string().openapi({ example: 'my-api' }),
}).openapi('Deleted')

// ── ID path param ─────────────────────────────────────────────────────

export const IdParamSchema = z.object({
  id: z.string().openapi({ example: 'openweathermap', description: 'API identifier (slug)' }),
})
