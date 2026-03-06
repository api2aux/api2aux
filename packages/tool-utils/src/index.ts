/**
 * @api2aux/tool-utils
 *
 * Shared pure functions for generating tool names, descriptions, and metadata
 * from API operations. Used by the app chat, MCP server, and hosted MCP worker.
 *
 * Zero dependencies — safe for Cloudflare Workers and any JS runtime.
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
 * Extract top-level field names from a JSON Schema response schema.
 * Handles object, array-of-objects, and allOf/oneOf/anyOf combiners.
 */
export function extractResponseFields(schema: unknown): string[] | null {
  if (!schema || typeof schema !== 'object') return null

  const s = schema as Record<string, unknown>

  if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
    return Object.keys(s.properties as Record<string, unknown>)
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
 * Prefers operationId (converted to snake_case), falls back to method_path.
 */
export function generateToolName(op: ToolOperation): string {
  if (op.operationId) {
    return op.operationId
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
 * Build a human-readable description for a tool from operation metadata.
 * Includes summary/description, tags, and response field names.
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

  const fields = extractResponseFields(op.responseSchema)
  if (fields && fields.length > 0) {
    const displayed = fields.length > 15
      ? [...fields.slice(0, 15), `+${fields.length - 15} more`]
      : fields
    parts.push(`Returns: ${displayed.join(', ')}`)
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
