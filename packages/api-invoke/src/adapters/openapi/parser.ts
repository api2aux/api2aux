/**
 * Parse OpenAPI 2.0/3.x specs into the spec-agnostic ParsedAPI format.
 * Extracted and consolidated from api2aux/semantic-analysis.
 */

import SwaggerParser from '@apidevtools/swagger-parser'
import type { OpenAPIV3, OpenAPIV2 } from 'openapi-types'
import type {
  ParsedAPI,
  Operation,
  Parameter,
  ParameterSchema,
  RequestBody,
  RequestBodySchema,
  RequestBodyProperty,
} from '../../core/types'
import { ContentType, ParamLocation, SpecFormat } from '../../core/types'
import { extractOpenAPI3BaseUrl, extractSwagger2BaseUrl } from './base-url'
import { mapSecuritySchemes } from './security'
import { deriveBaseUrl } from '../../core/url-builder'

/** Standard HTTP methods parsed from OpenAPI path items. */
const SUPPORTED_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

/**
 * Normalize an OpenAPI schema type field to a single type string.
 * Handles 3.1 type arrays (e.g. `["string", "null"]`) by picking the first non-null entry,
 * passes through plain strings, and falls back to the provided default for missing/unrecognized values.
 *
 * @param type - The type field from an OpenAPI schema (string, array, or undefined)
 * @param fallback - Fallback type when the value is missing or unrecognized (default: 'string')
 * @returns A single type string
 */
export function normalizeType(type: unknown, fallback = 'string'): string {
  if (Array.isArray(type)) {
    const nonNull = type.filter((t: string) => t !== 'null')
    return nonNull[0] ?? fallback
  }
  if (typeof type === 'string') return type
  return fallback
}

/**
 * Parse an OpenAPI 2.0 (Swagger) or 3.x spec into a spec-agnostic {@link ParsedAPI}.
 * Handles dereferencing, operation extraction, auth scheme mapping, and base URL resolution.
 *
 * @param specUrlOrObject - URL string pointing to a spec, or a pre-parsed spec object
 * @param options - Parse options
 * @param options.specUrl - Original spec URL (used for base URL fallback when spec has no servers/host field)
 * @param options.fetch - Custom fetch implementation. When provided, it is forwarded to
 *                        SwaggerParser as a `resolve.http.read` resolver so that the spec
 *                        download AND any external `$ref` resolution flow through the same
 *                        HTTP client. Used by callers wiring SSRF-safe fetches (e.g.
 *                        `@api2aux/safe-fetch`) — without this, SwaggerParser's built-in
 *                        HTTP resolver would bypass the custom fetch entirely.
 * @returns A normalized ParsedAPI with all operations, auth schemes, and metadata
 * @throws {Error} If the spec cannot be fetched, parsed, or dereferenced
 */
export async function parseOpenAPISpec(
  specUrlOrObject: string | object,
  options?: { specUrl?: string; fetch?: typeof globalThis.fetch },
): Promise<ParsedAPI> {
  try {
    // Build SwaggerParser options that route external $ref / spec downloads
    // through the caller's custom fetch when one is provided. The shape is the
    // documented json-schema-ref-parser resolver hook (SwaggerParser passes it
    // through to its underlying $RefParser unchanged).
    const refParserOptions = options?.fetch
      ? {
          resolve: {
            http: {
              read: async (file: { url: string }) => {
                const response = await options.fetch!(file.url)
                if (!response.ok) {
                  throw new Error(
                    `Failed to resolve $ref ${file.url}: ${response.status} ${response.statusText}`,
                  )
                }
                return await response.text()
              },
            },
          },
        }
      : undefined

    let apiRaw: unknown
    try {
      apiRaw = refParserOptions
        ? await SwaggerParser.dereference(specUrlOrObject as string, refParserOptions)
        : await SwaggerParser.dereference(specUrlOrObject as string)
    } catch {
      // Fallback: parse without resolving $refs (handles specs with broken references).
      // Pass the same resolver options so the fallback also goes through the custom fetch.
      apiRaw = refParserOptions
        ? await SwaggerParser.parse(specUrlOrObject as string, refParserOptions)
        : await SwaggerParser.parse(specUrlOrObject as string)
    }
    const api = apiRaw as unknown as OpenAPIV3.Document | OpenAPIV2.Document

    const isOpenAPI3 = 'openapi' in api
    const specVersion = isOpenAPI3
      ? (api as OpenAPIV3.Document).openapi
      : (api as OpenAPIV2.Document).swagger

    const title = api.info.title
    const version = api.info.version

    const sourceUrl = options?.specUrl ?? (typeof specUrlOrObject === 'string' ? specUrlOrObject : undefined)

    let baseUrl = isOpenAPI3
      ? extractOpenAPI3BaseUrl(api as OpenAPIV3.Document, sourceUrl)
      : extractSwagger2BaseUrl(api as OpenAPIV2.Document, sourceUrl)

    // Fallback: derive base URL from spec URL when spec doesn't provide one
    if (!baseUrl && sourceUrl) {
      baseUrl = deriveBaseUrl(sourceUrl)
    }

    const operations = extractOperations(api, isOpenAPI3)

    // Fix path overlap: when the resolved base URL has a path (e.g., /api/1)
    // and operation paths also start with that path (e.g., /api/1/metastore/...),
    // strip the overlapping prefix from operation paths to avoid duplication.
    if (baseUrl) {
      try {
        const basePath = new URL(baseUrl).pathname.replace(/\/$/, '')
        if (basePath && basePath !== '/') {
          const allOverlap = operations.length > 0 && operations.every(
            op => op.path === basePath || op.path.startsWith(basePath + '/')
          )
          if (allOverlap) {
            for (const op of operations) {
              op.path = op.path.slice(basePath.length) || '/'
            }
          }
        }
      } catch { /* ignore invalid base URL */ }
    }

    const authSchemes = extractSecuritySchemes(api, isOpenAPI3)

    return {
      title,
      version,
      baseUrl,
      operations,
      authSchemes,
      specFormat: isOpenAPI3 ? SpecFormat.OPENAPI_3 : SpecFormat.OPENAPI_2,
      rawSpecVersion: specVersion,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const urlInfo = typeof specUrlOrObject === 'string' ? ` from ${specUrlOrObject}` : ''
    throw new Error(`Failed to parse OpenAPI spec${urlInfo}: ${message}`, { cause: error })
  }
}

function extractOperations(
  api: OpenAPIV3.Document | OpenAPIV2.Document,
  isOpenAPI3: boolean,
): Operation[] {
  const operations: Operation[] = []
  if (!api.paths) return operations

  for (const [path, pathItem] of Object.entries(api.paths)) {
    if (!pathItem) continue
    const pathLevelParams = 'parameters' in pathItem ? pathItem.parameters ?? [] : []

    for (const method of SUPPORTED_METHODS) {
      if (!(method in pathItem) || !(pathItem as Record<string, unknown>)[method]) continue

      const op = (pathItem as Record<string, unknown>)[method] as OpenAPIV3.OperationObject | OpenAPIV2.OperationObject
      const operationParams = op.parameters ?? []
      const allParams = [...pathLevelParams, ...operationParams].filter(
        (p) => (p as { in: string }).in !== 'body', // 'body' is a Swagger 2.0-specific location, not in ParamLocation
      )

      const parameters = allParams.map((param) =>
        parseParameter(param as OpenAPIV3.ParameterObject | OpenAPIV2.Parameter, isOpenAPI3),
      )

      const requestBody = extractRequestBody(op, isOpenAPI3)
      const { primary: responseSchema, all: responseSchemas } = extractResponseSchemas(op, isOpenAPI3)
      const responseContentType = extractResponseContentType(op, isOpenAPI3)
      const errorHints = extractErrorHints(op)
      const security = extractOperationSecurity(op, api)

      // Generate a stable ID from operationId or method+path
      const id = op.operationId
        ?? `${method}_${path.replace(/[{}\/]/g, '_').replace(/^_|_$/g, '').replace(/_+/g, '_')}`

      operations.push({
        id,
        path,
        method: method.toUpperCase(),
        summary: op.summary,
        description: op.description,
        parameters,
        requestBody,
        responseSchema,
        responseSchemas: Object.keys(responseSchemas).length > 0 ? responseSchemas : undefined,
        responseContentType,
        errorHints,
        tags: op.tags ?? [],
        security,
      })
    }
  }

  return operations
}

function extractOperationSecurity(
  op: OpenAPIV3.OperationObject | OpenAPIV2.OperationObject,
  api: OpenAPIV3.Document | OpenAPIV2.Document,
): string[][] | undefined {
  // Per-operation security overrides global
  if ('security' in op && op.security !== undefined) {
    return (op.security as Record<string, string[]>[]).map(req => Object.keys(req))
  }
  // Fall back to global security
  if ('security' in api && api.security !== undefined) {
    return (api.security as Record<string, string[]>[]).map(req => Object.keys(req))
  }
  return undefined
}

function parseParameter(
  param: OpenAPIV3.ParameterObject | OpenAPIV2.Parameter,
  isOpenAPI3: boolean,
): Parameter {
  const name = param.name
  const location = param.in as ParamLocation
  const required = param.required ?? location === ParamLocation.PATH
  const description = param.description ?? ''

  let schema: ParameterSchema

  if (isOpenAPI3) {
    const p = param as OpenAPIV3.ParameterObject
    const s = p.schema as OpenAPIV3.SchemaObject | undefined
    schema = {
      type: normalizeType(s?.type),
      format: s?.format,
      enum: s?.enum,
      default: s?.default,
      example: p.example ?? s?.example,
      minimum: s?.minimum,
      maximum: s?.maximum,
      maxLength: s?.maxLength,
      // TODO: extract s?.items for array parameters (ParameterSchema.items)
    }
  } else {
    const p = param as OpenAPIV2.GeneralParameterObject
    schema = {
      type: ('type' in p ? p.type : undefined) ?? 'string',
      format: 'format' in p ? p.format : undefined,
      enum: 'enum' in p ? p.enum : undefined,
      default: 'default' in p ? p.default : undefined,
      example: 'x-example' in p ? (p as Record<string, unknown>)['x-example'] : undefined,
      minimum: 'minimum' in p ? p.minimum : undefined,
      maximum: 'maximum' in p ? p.maximum : undefined,
      maxLength: 'maxLength' in p ? p.maxLength : undefined,
      // TODO: extract p.items for array parameters (ParameterSchema.items)
    }
  }

  return { name, in: location, required, description, schema }
}

/** Content types to try, in priority order. */
const CONTENT_TYPE_PRIORITY = [
  ContentType.JSON,
  ContentType.FORM_URLENCODED,
  ContentType.MULTIPART,
  ContentType.XML,
  ContentType.TEXT,
  ContentType.OCTET_STREAM,
] as const

function extractRequestBody(
  operation: OpenAPIV3.OperationObject | OpenAPIV2.OperationObject,
  isOpenAPI3: boolean,
): RequestBody | undefined {
  if (isOpenAPI3) {
    const op = operation as OpenAPIV3.OperationObject
    if (!op.requestBody) return undefined
    const body = op.requestBody as OpenAPIV3.RequestBodyObject
    if (!body.content) return undefined

    // Try content types in priority order
    for (const ct of CONTENT_TYPE_PRIORITY) {
      const mediaType = body.content[ct]
      if (mediaType?.schema) {
        return {
          required: body.required ?? false,
          description: body.description,
          contentType: ct,
          schema: flattenSchema(mediaType.schema as OpenAPIV3.SchemaObject),
        }
      }
    }

    // Fallback: use the first available content type
    const firstKey = Object.keys(body.content)[0]
    if (firstKey) {
      const mediaType = body.content[firstKey]
      if (mediaType?.schema) {
        return {
          required: body.required ?? false,
          description: body.description,
          contentType: firstKey,
          schema: flattenSchema(mediaType.schema as OpenAPIV3.SchemaObject),
        }
      }
    }

    return undefined
  } else {
    const op = operation as OpenAPIV2.OperationObject
    const bodyParam = op.parameters?.find(
      (p: unknown) => (p as { in: string }).in === 'body',
    ) as OpenAPIV2.InBodyParameterObject | undefined
    if (!bodyParam?.schema) return undefined

    // Swagger 2.0: check operation-level consumes for content type
    const consumes = op.consumes ?? []
    let contentType: string = ContentType.JSON
    if (consumes.includes(ContentType.FORM_URLENCODED)) {
      contentType = ContentType.FORM_URLENCODED
    } else if (consumes.includes(ContentType.MULTIPART)) {
      contentType = ContentType.MULTIPART
    } else if (consumes.length > 0) {
      contentType = consumes[0]!
    }

    return {
      required: bodyParam.required ?? false,
      description: bodyParam.description,
      contentType,
      schema: flattenSchema(bodyParam.schema as unknown as OpenAPIV3.SchemaObject),
    }
  }
}

function flattenSchema(schema: OpenAPIV3.SchemaObject): RequestBodySchema {
  const normalizedType = normalizeType(schema.type, 'object')
  const result: RequestBodySchema = {
    type: normalizedType,
    raw: schema,
  }

  if (normalizedType === 'object' && schema.properties) {
    result.properties = {}
    result.required = schema.required

    for (const [name, propSchema] of Object.entries(schema.properties)) {
      const prop = propSchema as OpenAPIV3.SchemaObject
      const propType = normalizeType(prop.type)
      const isNested = propType === 'object' || propType === 'array'
      result.properties[name] = {
        type: propType,
        format: prop.format,
        description: prop.description,
        enum: prop.enum,
        default: prop.default,
        example: prop.example,
        nested: isNested || undefined,
      } satisfies RequestBodyProperty
    }
  }

  return result
}

/** Status codes to extract response schemas for (success + default). The primary schema is selected from the success codes in this list; 'default' is collected into responseSchemas but never used as primary. */
const RESPONSE_STATUS_CODES = ['200', '201', '202', '204', '2XX', 'default'] as const

function extractResponseSchemas(
  operation: OpenAPIV3.OperationObject | OpenAPIV2.OperationObject,
  isOpenAPI3: boolean,
): { primary: unknown; all: Record<string, unknown> } {
  const responses = operation.responses
  if (!responses) return { primary: undefined, all: {} }

  const all: Record<string, unknown> = {}
  for (const code of RESPONSE_STATUS_CODES) {
    const resp = responses[code]
    if (!resp) continue

    let schema: unknown
    if (isOpenAPI3) {
      schema = (resp as OpenAPIV3.ResponseObject).content?.[ContentType.JSON]?.schema
    } else {
      schema = (resp as OpenAPIV2.ResponseObject).schema
    }
    if (schema) {
      all[code] = schema
    }
  }

  // Primary: first success schema found (204 is excluded since it typically has no body; 'default' is excluded since it often describes errors)
  const primary = all['200'] ?? all['201'] ?? all['202'] ?? all['2XX']
  return { primary, all }
}

/** Common error status codes to extract descriptions from. */
const ERROR_STATUS_CODES = ['400', '401', '403', '404', '409', '422', '429', '500'] as const

/** Extract error response descriptions (not full schemas) for LLM hints. */
function extractErrorHints(
  operation: OpenAPIV3.OperationObject | OpenAPIV2.OperationObject,
): Record<string, string> | undefined {
  const responses = operation.responses
  if (!responses) return undefined

  const hints: Record<string, string> = {}
  for (const code of ERROR_STATUS_CODES) {
    const resp = responses[code] as OpenAPIV3.ResponseObject | OpenAPIV2.ResponseObject | undefined
    if (!resp?.description) continue
    hints[code] = resp.description
  }

  return Object.keys(hints).length > 0 ? hints : undefined
}

function extractResponseContentType(
  operation: OpenAPIV3.OperationObject | OpenAPIV2.OperationObject,
  isOpenAPI3: boolean,
): string | undefined {
  // Determine response content type from the first available success response
  const responses = operation.responses
  if (!responses) return undefined

  const successResponse = responses['200'] ?? responses['201'] ?? responses['202']
    ?? responses['2XX']
  if (!successResponse) return undefined

  if (isOpenAPI3) {
    const resp = successResponse as OpenAPIV3.ResponseObject
    if (!resp.content) return undefined
    // Return first content type, preferring application/json
    const types = Object.keys(resp.content)
    if (types.includes(ContentType.JSON)) return ContentType.JSON
    return types[0]
  } else {
    // Swagger 2.0: check operation-level `produces`
    const op = operation as OpenAPIV2.OperationObject
    const produces = op.produces
    if (produces && produces.length > 0) {
      if (produces.includes(ContentType.JSON)) return ContentType.JSON
      return produces[0]
    }
    return undefined // No operation-level produces; caller falls back to default Accept header
  }
}

function extractSecuritySchemes(
  api: OpenAPIV3.Document | OpenAPIV2.Document,
  isOpenAPI3: boolean,
) {
  if (isOpenAPI3) {
    const openapi3 = api as OpenAPIV3.Document
    const rawSchemes = openapi3.components?.securitySchemes ?? {}
    const schemes: Record<string, OpenAPIV3.SecuritySchemeObject> = {}
    for (const [name, scheme] of Object.entries(rawSchemes)) {
      if (scheme && !('$ref' in scheme)) {
        schemes[name] = scheme as OpenAPIV3.SecuritySchemeObject
      }
    }
    return mapSecuritySchemes(schemes)
  } else {
    const swagger2 = api as OpenAPIV2.Document
    return mapSecuritySchemes(swagger2.securityDefinitions ?? {})
  }
}
