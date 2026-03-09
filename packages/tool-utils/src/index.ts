/**
 * @api2aux/tool-utils
 *
 * Shared pure functions for generating tool names, descriptions, and metadata
 * from API operations. Used by the app chat, MCP server, and hosted MCP worker.
 *
 * Zero dependencies — safe for any JS runtime.
 */

export type {
  ToolOperation,
  DescriptionOptions,
  ToolParameter,
  ToolParameterSchema,
  ToolRequestBody,
  ToolOperationWithParams,
  JsonSchemaProperty,
  UnifiedToolDefinition,
} from './types'
export { ParameterIn } from './types'

import type {
  ToolOperation,
  DescriptionOptions,
  ToolParameter,
  ToolOperationWithParams,
  JsonSchemaProperty,
  UnifiedToolDefinition,
} from './types'

/**
 * Extract meaningful field names from a JSON Schema response schema.
 * Unwraps common list-wrapper patterns like { count, results: [{...items}] }
 * to return the actual entity/DTO fields, not the pagination wrapper.
 */
export function extractResponseFields(schema: unknown): string[] | null {
  if (!schema || typeof schema !== 'object') return null

  const s = schema as Record<string, unknown>

  if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
    const props = s.properties as Record<string, Record<string, unknown>>
    const keys = Object.keys(props)

    // Unwrap list wrappers: if the object has few top-level fields and one is
    // an array-of-objects, return the array item fields (the actual DTO).
    // e.g. { count: number, results: [{ index, name, url }] } → [index, name, url]
    if (keys.length <= 4) {
      for (const key of keys) {
        const prop = props[key]
        if (prop && prop.type === 'array' && prop.items && typeof prop.items === 'object') {
          const items = prop.items as Record<string, unknown>
          if (items.properties && typeof items.properties === 'object') {
            return Object.keys(items.properties as Record<string, unknown>)
          }
        }
      }
    }

    return keys
  }

  if (s.type === 'array' && s.items && typeof s.items === 'object') {
    const items = s.items as Record<string, unknown>
    if (items.properties && typeof items.properties === 'object') {
      return Object.keys(items.properties as Record<string, unknown>)
    }
  }

  for (const combiner of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(s[combiner])) {
      for (const sub of s[combiner] as unknown[]) {
        const fields = extractResponseFields(sub)
        if (fields) return fields
      }
    }
  }

  return null
}

/**
 * Generate a tool name from an operation.
 * Prefers id (converted to snake_case), falls back to method_path.
 */
export function generateToolName(op: ToolOperation): string {
  if (op.id) {
    return op.id
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
  }

  const pathSegments = op.path
    .replace(/\{[^}]+\}/g, 'by_id')
    .split('/')
    .filter(Boolean)
    .join('_')

  return `${op.method.toLowerCase()}_${pathSegments}`
}

/**
 * Simple name sanitizer: strips invalid chars and truncates to 64 chars.
 * Used when the name is already formed (e.g. from operationId or method_path).
 */
export function sanitizeToolName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 64)
}

/**
 * Summarize a JSON Schema response DTO into a compact, LLM-friendly string.
 * Includes field names, types, descriptions, enums, and nested structure.
 * Returns null if schema has no useful structure.
 *
 * Example output:
 *   "{ index: string, name: string, desc: string[] (Full description), level: integer, class: { index, name, url } }"
 */
export function summarizeResponseSchema(schema: unknown, depth = 0): string | null {
  if (!schema || typeof schema !== 'object' || depth > 3) return null

  const s = schema as Record<string, unknown>

  // Handle combiners
  for (const combiner of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(s[combiner])) {
      for (const sub of s[combiner] as unknown[]) {
        const result = summarizeResponseSchema(sub, depth)
        if (result) return result
      }
    }
  }

  // Array of objects
  if (s.type === 'array' && s.items && typeof s.items === 'object') {
    const itemSummary = summarizeResponseSchema(s.items, depth)
    if (itemSummary) return `${itemSummary}[]`
    return null
  }

  // Object with properties — the main case
  if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
    const props = s.properties as Record<string, Record<string, unknown>>
    const entries = Object.entries(props)
    if (entries.length === 0) return null

    // Unwrap list wrappers (e.g. { count, results: [{...}] })
    if (entries.length <= 4 && depth === 0) {
      for (const [, prop] of entries) {
        if (prop.type === 'array' && prop.items && typeof prop.items === 'object') {
          const items = prop.items as Record<string, unknown>
          if (items.properties) {
            const inner = summarizeResponseSchema(prop, depth)
            if (inner) return inner
          }
        }
      }
    }

    const fieldStrs: string[] = []
    for (const [name, prop] of entries) {
      fieldStrs.push(summarizeProperty(name, prop, depth))
    }

    // Cap fields to keep it reasonable
    const max = depth === 0 ? 20 : 6
    if (fieldStrs.length > max) {
      const shown = fieldStrs.slice(0, max)
      shown.push(`+${fieldStrs.length - max} more`)
      return `{ ${shown.join(', ')} }`
    }

    return `{ ${fieldStrs.join(', ')} }`
  }

  return null
}

/**
 * Summarize a single property into a compact string.
 */
function summarizeProperty(name: string, prop: Record<string, unknown>, depth: number): string {
  const type = prop.type as string | undefined
  const desc = prop.description as string | undefined
  const enumVals = prop.enum as unknown[] | undefined

  // Nested object
  if (type === 'object' && prop.properties) {
    const nested = summarizeResponseSchema(prop, depth + 1)
    if (nested) return `${name}: ${nested}`
  }

  // Array
  if (type === 'array' && prop.items && typeof prop.items === 'object') {
    const items = prop.items as Record<string, unknown>
    if (items.properties) {
      const nested = summarizeResponseSchema(items, depth + 1)
      if (nested) return `${name}: ${nested}[]`
    }
    const itemType = items.type as string | undefined
    return `${name}: ${itemType || 'any'}[]`
  }

  // Simple field
  let str = `${name}: ${type || 'any'}`

  // Add enum values if small
  if (enumVals && enumVals.length <= 6) {
    str += ` (${enumVals.join('|')})`
  } else if (desc && desc.length <= 60) {
    // Add short description
    str += ` (${desc})`
  }

  return str
}

/**
 * Build a human-readable description for a tool from operation metadata.
 * Includes summary/description, tags, and response DTO schema.
 *
 * @param opts.includePath - Add "METHOD /path" after summary (useful for LLM chat context)
 */
export function generateDescription(op: ToolOperation, opts?: DescriptionOptions): string {
  const parts: string[] = []

  if (op.summary) {
    parts.push(op.summary)
  } else if (op.description) {
    const firstSentence = op.description.split(/\.\s/)[0]
    parts.push(firstSentence ? firstSentence + '.' : op.description)
  } else {
    parts.push(`${op.method.toUpperCase()} ${op.path}`)
  }

  if (opts?.includePath && (op.summary || op.description)) {
    parts.push(`${op.method.toUpperCase()} ${op.path}`)
  }

  if (op.tags.length > 0) {
    parts.push(`Tags: ${op.tags.join(', ')}`)
  }

  // Include full DTO schema summary for LLM context
  const dtoSummary = summarizeResponseSchema(op.responseSchema)
  if (dtoSummary) {
    parts.push(`Returns: ${dtoSummary}`)
  } else {
    // Fall back to field names only
    const fields = extractResponseFields(op.responseSchema)
    if (fields && fields.length > 0) {
      const displayed = fields.length > 15
        ? [...fields.slice(0, 15), `+${fields.length - 15} more`]
        : fields
      parts.push(`Returns: ${displayed.join(', ')}`)
    }
  }

  return parts.join(' | ')
}

// ── Unified Tool Definition generation ──────────────────────────────

/**
 * Convert a ToolParameter into a JSON Schema property.
 */
export function parameterToJsonSchema(param: ToolParameter): JsonSchemaProperty {
  const prop: JsonSchemaProperty = {
    type: param.schema.type === 'integer' || param.schema.type === 'number' ? 'number' : 'string',
  }

  if (param.schema.type === 'boolean') {
    prop.type = 'boolean'
  }

  const descParts: string[] = []
  if (param.description) descParts.push(param.description)
  if (param.schema.format) descParts.push(`Format: ${param.schema.format}`)
  if (param.schema.default !== undefined) descParts.push(`Default: ${String(param.schema.default)}`)
  if (param.schema.example !== undefined) descParts.push(`Example: ${String(param.schema.example)}`)
  if (descParts.length > 0) prop.description = descParts.join('. ')

  if (param.schema.enum && param.schema.enum.length > 0) {
    prop.enum = param.schema.enum.map(String)
  }

  if (param.schema.minimum !== undefined) prop.minimum = param.schema.minimum
  if (param.schema.maximum !== undefined) prop.maximum = param.schema.maximum
  if (param.schema.maxLength !== undefined) prop.maxLength = param.schema.maxLength

  return prop
}

/**
 * Generate a single UnifiedToolDefinition from an operation with parameters.
 */
export function generateToolDefinition(
  op: ToolOperationWithParams,
  opts?: DescriptionOptions,
): UnifiedToolDefinition {
  const properties: Record<string, JsonSchemaProperty> = {}
  const required: string[] = []

  for (const param of op.parameters) {
    properties[param.name] = parameterToJsonSchema(param)
    if (param.required) {
      required.push(param.name)
    }
  }

  if (op.requestBody) {
    const bodyDesc = op.requestBody.description || 'Request body (JSON)'
    properties['body'] = {
      type: 'string',
      description: `${bodyDesc}. Pass as JSON string.`,
    }
    if (op.requestBody.required) {
      required.push('body')
    }
  }

  return {
    name: generateToolName(op),
    description: generateDescription(op, opts),
    inputSchema: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  }
}

/**
 * Batch version — generate UnifiedToolDefinitions for multiple operations.
 */
export function generateToolDefinitions(
  operations: ToolOperationWithParams[],
  opts?: DescriptionOptions,
): UnifiedToolDefinition[] {
  return operations.map(op => generateToolDefinition(op, opts))
}

/**
 * Generate a UnifiedToolDefinition for a raw URL (non-OpenAPI) endpoint.
 */
export function generateRawUrlToolDefinition(
  url: string,
  queryParams: Array<{ name: string; values?: string[] }>,
): UnifiedToolDefinition {
  const parsedUrl = new URL(url)
  const hostname = parsedUrl.hostname.replace(/^(www|api)\./, '')
  const pathname = parsedUrl.pathname.replace(/\/$/, '')
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${pathname}`

  const properties: Record<string, JsonSchemaProperty> = {
    path: {
      type: 'string',
      description: `Optional sub-path to append AFTER the base path "${pathname}". For example "/1" to get item by ID, or "/search" for a search endpoint. Do NOT repeat "${pathname}" — it is already included. Omit this parameter to call the base URL as-is.`,
    },
  }

  for (const param of queryParams) {
    properties[param.name] = {
      type: 'string',
      description: `Query parameter: ${param.name}`,
      ...(param.values?.[0] ? { default: param.values[0] } : {}),
    }
  }

  return {
    name: 'query_api',
    description: `Query the REST API at ${hostname}. The base URL is ${baseUrl}. You can append path segments and set query parameters to filter or navigate the data.`,
    inputSchema: {
      type: 'object',
      properties,
    },
  }
}
