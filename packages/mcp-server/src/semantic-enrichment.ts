/**
 * Semantic enrichment for MCP tool definitions.
 * Uses @api2aux/semantic-analysis to make tool descriptions dramatically better
 * than what basic OpenAPI → MCP converters produce.
 */

import { z } from 'zod'
import {
  analyzeApiResponse,
  detectSemantics,
  getBestMatch,
  enrichmentRegistry,
} from '@api2aux/semantic-analysis'
import type { OperationContext, OperationContextParam } from '@api2aux/semantic-analysis'
import type { Operation, Parameter } from 'api-invoke'
import { HttpMethod, ParamLocation, ContentType, HeaderName } from 'api-invoke'
import type { GeneratedTool } from './tool-generator'
import type { Workflow } from '@api2aux/workflow-inference'

// ---------------------------------------------------------------------------
// Semantic Zod validation — stricter schemas based on detected category
// ---------------------------------------------------------------------------

const SEMANTIC_VALIDATORS: Record<string, (base: z.ZodString) => z.ZodTypeAny> = {
  email: (base) => base.email(),
  url: (base) => base.url(),
  uuid: (base) => base.uuid(),
}

const SEMANTIC_EXAMPLES: Record<string, string> = {
  email: 'user@example.com',
  uuid: '123e4567-e89b-12d3-a456-426614174000',
  url: 'https://example.com',
  phone: '+1-555-0123',
  price: '29.99',
  rating: '4.5',
  date: '2025-01-15',
  name: 'John Doe',
  image_url: 'https://example.com/image.jpg',
  color: '#FF5733',
}

/**
 * Well-known parameter name patterns that map to semantic categories.
 * Used when sample values aren't available (which is the norm for input params).
 */
const NAME_CATEGORY_MAP: Array<[RegExp, string]> = [
  [/^e[-_]?mail$/i, 'email'],
  [/^(url|uri|href|link|website)$/i, 'url'],
  [/^(uuid|guid)$/i, 'uuid'],
  [/^(image[-_]?url|photo[-_]?url|avatar[-_]?url|thumbnail[-_]?url|icon[-_]?url)$/i, 'image_url'],
  [/^(phone|telephone|mobile|cell)$/i, 'phone'],
  [/^(price|cost|amount|total|subtotal)$/i, 'price'],
  [/^(rating|score|stars)$/i, 'rating'],
  [/^(date|created[-_]?at|updated[-_]?at|timestamp|born|birthday|dob)$/i, 'date'],
  [/^(name|full[-_]?name|first[-_]?name|last[-_]?name|display[-_]?name)$/i, 'name'],
  [/^(color|colour)$/i, 'color'],
]

/**
 * Detect semantic category from parameter name using regex patterns.
 */
function detectCategoryByName(name: string): string | null {
  for (const [pattern, category] of NAME_CATEGORY_MAP) {
    if (pattern.test(name)) return category
  }
  return null
}

/**
 * Enhance a parameter's Zod schema based on semantic detection.
 */
function enhanceParameterSchema(
  param: Parameter,
  zodSchema: z.ZodTypeAny
): z.ZodTypeAny {
  // Only enhance string parameters
  if (param.schema.type !== 'string') return zodSchema

  // Try semantic detection with sample values first (if available from OpenAPI examples)
  let category: string | null = null

  if (param.schema.example) {
    const results = detectSemantics(
      param.name,
      param.name,
      'string',
      [param.schema.example]
    )
    const best = getBestMatch(results)
    if (best) category = best.category as string
  }

  // Fall back to name-based detection
  if (!category) {
    category = detectCategoryByName(param.name)
  }

  if (!category) return zodSchema

  // Apply stricter validation if available
  const validator = SEMANTIC_VALIDATORS[category]
  if (validator && zodSchema instanceof z.ZodString) {
    const enhanced = validator(zodSchema)
    const example = SEMANTIC_EXAMPLES[category]
    if (example) {
      return enhanced.describe(
        `${param.description || param.name}. Example: ${example}`
      )
    }
    return enhanced
  }

  // Add example to description even without stricter validation
  const example = SEMANTIC_EXAMPLES[category]
  if (example) {
    return zodSchema.describe(
      `${param.description || param.name}. Example: ${example}`
    )
  }

  return zodSchema
}

// ---------------------------------------------------------------------------
// Response field enrichment — describe what the tool returns
// ---------------------------------------------------------------------------

/**
 * Extract semantic field descriptions from already-fetched API response data.
 * Reusable by both OpenAPI enrichment and raw API mode.
 */
export function describeFieldsFromData(data: unknown, url: string): string | null {
  try {
    const analysis = analyzeApiResponse(data, url)

    // Only use top-level path analyses ($ or $[]) to avoid noisy nested detections
    const seen = new Set<string>()
    const fieldDescriptions: string[] = []
    const topPaths = Object.keys(analysis.paths).filter(
      p => p === '$' || p === '$[]'
    )

    for (const pathKey of topPaths) {
      const pathAnalysis = analysis.paths[pathKey]
      if (!pathAnalysis) continue
      for (const [fieldPath, metadata] of pathAnalysis.semantics) {
        if (
          metadata.detectedCategory &&
          (metadata.level === 'high' || metadata.level === 'medium')
        ) {
          const fieldName = fieldPath.split('.').pop() || fieldPath
          if (seen.has(fieldName)) continue
          seen.add(fieldName)
          fieldDescriptions.push(
            `${fieldName} (${formatCategory(metadata.detectedCategory)})`
          )
        }
      }
    }

    if (fieldDescriptions.length === 0) return null

    // Cap at 8 fields to keep descriptions concise
    const capped = fieldDescriptions.slice(0, 8)
    const suffix = fieldDescriptions.length > 8
      ? `, and ${fieldDescriptions.length - 8} more`
      : ''

    return `Returns: ${capped.join(', ')}${suffix}`
  } catch (err) {
    console.error('[api2aux-mcp] Semantic field analysis failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Generate a semantic description of response fields by fetching sample data.
 */
async function describeResponseFields(
  baseUrl: string,
  operation: Operation
): Promise<string | null> {
  // Only enrich GET endpoints with no required path params (safe to fetch)
  if (operation.method.toUpperCase() !== HttpMethod.GET) return null
  const hasRequiredPathParams = operation.parameters.some(
    p => p.in === ParamLocation.PATH && p.required
  )
  if (hasRequiredPathParams) return null

  try {
    const url = new URL(operation.path, baseUrl).toString()
    const response = await fetch(url, {
      headers: { [HeaderName.ACCEPT]: ContentType.JSON },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) return null

    const data = await response.json()
    return describeFieldsFromData(data, url)
  } catch (err) {
    console.error('[api2aux-mcp] Response enrichment skipped:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Format a semantic category for human reading.
 */
function formatCategory(category: string): string {
  const labels: Record<string, string> = {
    price: 'currency/price',
    email: 'email address',
    phone: 'phone number',
    url: 'URL',
    image_url: 'image URL',
    rating: 'rating score',
    date: 'date/time',
    name: 'name/identity',
    description: 'description',
    status: 'status indicator',
    color: 'color value',
    uuid: 'unique identifier',
    address: 'address',
    coordinates: 'coordinates',
    percentage: 'percentage',
    count: 'count/quantity',
    tags: 'tags/labels',
  }
  return labels[category] || category
}

// ---------------------------------------------------------------------------
// Parameter ordering by importance
// ---------------------------------------------------------------------------

/**
 * Sort parameters: path params first, then required, then optional.
 * Within each group, semantically detected params come first.
 */
function sortParameters(params: Parameter[]): Parameter[] {
  return [...params].sort((a, b) => {
    // Path params always first
    if (a.in === ParamLocation.PATH && b.in !== ParamLocation.PATH) return -1
    if (b.in === ParamLocation.PATH && a.in !== ParamLocation.PATH) return 1

    // Required before optional
    if (a.required && !b.required) return -1
    if (b.required && !a.required) return 1

    return 0
  })
}

// ---------------------------------------------------------------------------
// Enrichment plugin integration
// ---------------------------------------------------------------------------

/**
 * Convert an api-invoke Operation to an OperationContext for enrichment plugins.
 */
function toOperationContext(op: Operation): OperationContext {
  const params: OperationContextParam[] = op.parameters.map(p => ({
    name: p.name,
    in: p.in,
    type: p.schema.type,
    format: p.schema.format,
    required: p.required,
  }))

  // Extract response field names from schema
  const responseFieldNames: string[] = []
  if (op.responseSchema && typeof op.responseSchema === 'object') {
    const schema = op.responseSchema as Record<string, unknown>
    if (schema.properties && typeof schema.properties === 'object') {
      responseFieldNames.push(...Object.keys(schema.properties as Record<string, unknown>))
    }
  }

  return {
    id: op.id,
    path: op.path,
    method: op.method,
    tags: op.tags,
    parameters: params,
    responseFieldNames,
    summary: op.summary,
    description: op.description,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enrich generated tools with semantic information.
 * Enhances descriptions, parameter schemas, and ordering.
 * Also applies enrichment plugin hints and workflow context from the registry.
 */
export async function enrichTools(
  tools: GeneratedTool[],
  baseUrl: string,
  options?: { fetchSamples?: boolean; workflows?: Workflow[] }
): Promise<GeneratedTool[]> {
  // Collect enrichment plugin hints for all operations
  const operations = tools.map(t => t.operation)
  const opContexts = operations.map(toOperationContext)
  let pluginToolHints: Map<string, import('@api2aux/semantic-analysis').ToolEnrichmentHint>
  try {
    pluginToolHints = enrichmentRegistry.getToolHints(opContexts)
  } catch (err) {
    console.error('[api2aux-mcp] enrichmentRegistry.getToolHints() failed:', err)
    pluginToolHints = new Map()
  }

  const enriched: GeneratedTool[] = []

  for (const tool of tools) {
    const op = tool.operation

    // 1. Enhance parameter schemas with semantic validation
    let enhancedSchema: Record<string, z.ZodTypeAny> = { ...tool.inputSchema }
    try {
      const schema: Record<string, z.ZodTypeAny> = {}
      const sortedParams = sortParameters(op.parameters)

      for (const param of sortedParams) {
        const original = tool.inputSchema[param.name]
        if (original) {
          schema[param.name] = enhanceParameterSchema(param, original)
        }
      }

      // Keep body param if present
      if (tool.inputSchema['body']) {
        schema['body'] = tool.inputSchema['body']
      }

      enhancedSchema = schema
    } catch (err) {
      console.error(`[api2aux-mcp] Schema enhancement failed for "${tool.name}":`, err)
    }

    // 2. Enrich description with response field semantics
    let description = tool.description
    if (options?.fetchSamples) {
      const responseDesc = await describeResponseFields(baseUrl, op)
      if (responseDesc) {
        description = `${description}. ${responseDesc}`
      }
    }

    // 3. Apply enrichment plugin hints
    try {
      const pluginHint = pluginToolHints.get(op.id)
      if (pluginHint?.descriptionSuffix) {
        description = `${description}. ${pluginHint.descriptionSuffix}`
      }
    } catch (err) {
      console.error(`[api2aux-mcp] Plugin hint application failed for "${tool.name}":`, err)
    }

    // 4. Add workflow context if available
    try {
      if (options?.workflows) {
        const relevantWorkflows = options.workflows.filter(w =>
          w.steps.some(s => s.operationId === op.id)
        )
        for (const wf of relevantWorkflows.slice(0, 2)) {
          const stepNames = wf.steps.map(s => s.operationId).join(' → ')
          const thisStep = wf.steps.find(s => s.operationId === op.id)
          const bindings = thisStep?.inputBindings
            .map(b => `${b.targetParam} from ${b.sourceField}`)
            .join(', ')
          let hint = `Part of ${wf.name} workflow: ${stepNames}`
          if (bindings) {
            hint += `. Use ${bindings}`
          }
          description = `${description}. ${hint}`
        }
      }
    } catch (err) {
      console.error(`[api2aux-mcp] Workflow context failed for "${tool.name}":`, err)
    }

    enriched.push({
      ...tool,
      description,
      inputSchema: enhancedSchema,
    })
  }

  return enriched
}
