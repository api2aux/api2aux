/**
 * Converter from api-invoke Operation[] to InferenceOperation[].
 * Extracts response and request body fields from JSON schemas.
 */

import type { InferenceOperation, InferenceParam, InferenceField } from './types'

/**
 * Minimal operation interface satisfied by api-invoke's Operation.
 * Uses structural typing to avoid a hard dependency on api-invoke.
 */
interface SourceOperation {
  id: string
  path: string
  method: string
  tags: string[]
  summary?: string
  parameters: Array<{
    name: string
    in: string
    required: boolean
    schema: { type: string; format?: string }
  }>
  responseSchema?: unknown
  requestBody?: {
    schema: { properties?: Record<string, { type?: string; format?: string }> }
  }
}

/**
 * Extract top-level fields from a JSON Schema.
 * Handles object, array-of-objects, and common list-wrapper patterns.
 */
function extractFieldsFromSchema(schema: unknown, prefix = ''): InferenceField[] {
  if (!schema || typeof schema !== 'object') return []

  const s = schema as Record<string, unknown>

  // Object with properties
  if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
    const props = s.properties as Record<string, Record<string, unknown>>
    const keys = Object.keys(props)

    // Unwrap list wrappers: { count, results: [{...}] }
    if (keys.length <= 4) {
      for (const key of keys) {
        const prop = props[key]
        if (prop && prop.type === 'array' && prop.items && typeof prop.items === 'object') {
          const items = prop.items as Record<string, unknown>
          if (items.properties && typeof items.properties === 'object') {
            return extractFieldsFromSchema(items, prefix)
          }
        }
      }
    }

    return keys.map(name => {
      const prop = props[name]
      return {
        name,
        type: (prop?.type as string) || 'string',
        format: prop?.format as string | undefined,
        path: prefix ? `${prefix}.${name}` : name,
      }
    })
  }

  // Array of objects
  if (s.type === 'array' && s.items && typeof s.items === 'object') {
    const items = s.items as Record<string, unknown>
    if (items.properties && typeof items.properties === 'object') {
      return extractFieldsFromSchema(items, prefix)
    }
  }

  // Combiners (allOf, oneOf, anyOf)
  for (const combiner of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(s[combiner])) {
      for (const sub of s[combiner] as unknown[]) {
        const fields = extractFieldsFromSchema(sub, prefix)
        if (fields.length > 0) return fields
      }
    }
  }

  return []
}

/**
 * Convert a single source operation to an InferenceOperation.
 */
function convertOperation(op: SourceOperation): InferenceOperation {
  const parameters: InferenceParam[] = op.parameters.map(p => ({
    name: p.name,
    in: p.in,
    type: p.schema.type,
    format: p.schema.format,
    required: p.required,
  }))

  const responseFields = extractFieldsFromSchema(op.responseSchema)

  const requestBodyFields: InferenceField[] = []
  if (op.requestBody?.schema?.properties) {
    for (const [name, prop] of Object.entries(op.requestBody.schema.properties)) {
      requestBodyFields.push({
        name,
        type: prop.type || 'string',
        format: prop.format,
        path: name,
      })
    }
  }

  return {
    id: op.id,
    path: op.path,
    method: op.method.toUpperCase(),
    tags: op.tags,
    summary: op.summary,
    parameters,
    responseFields,
    requestBodyFields,
  }
}

/**
 * Convert api-invoke Operation[] to InferenceOperation[].
 */
export function operationsToInference(operations: SourceOperation[]): InferenceOperation[] {
  return operations.map(convertOperation)
}

// Also export the internal helper for testing
export { extractFieldsFromSchema }
