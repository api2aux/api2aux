/**
 * GraphQL adapter — parses introspection schemas into ParsedAPI.
 * Accepts a live endpoint URL (runs introspection) or an introspection JSON object.
 */

import type { ParsedAPI, Operation, RequestBody, RequestBodyProperty } from '../../core/types'
import { HttpMethod, ContentType, SpecFormat } from '../../core/types'
import { ApiInvokeError, ErrorKind } from '../../core/errors'
import { INTROSPECTION_QUERY, TypeKind } from './introspection'
import type { IntrospectionSchema, IntrospectionType, IntrospectionField, IntrospectionInputValue, IntrospectionTypeRef } from './introspection'
import { buildQueryString, unwrapType, isNonNull, formatTypeRef } from './query-builder'

/** Options for parsing a GraphQL schema. */
export interface GraphQLParseOptions {
  /** GraphQL endpoint URL. Strongly recommended when input is introspection JSON — without it, baseUrl defaults to '/graphql' (a relative path). Inferred automatically when input is a URL string. */
  endpoint?: string
  /** Custom fetch implementation for introspection queries. Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch
  /** Maximum depth for auto-generated query selection sets. Default: 2. */
  maxDepth?: number
}

/**
 * Parse a GraphQL schema into a ParsedAPI.
 *
 * @param input - Either an endpoint URL (string starting with http) or an introspection result object.
 *   URL: runs introspection query against the endpoint.
 *   Object: expects `{ data: { __schema: ... } }` or `{ __schema: ... }` shape.
 * @param options - Configuration options.
 * @returns A ParsedAPI with one operation per query/mutation/subscription field.
 */
export async function parseGraphQLSchema(
  input: string | object,
  options?: GraphQLParseOptions,
): Promise<ParsedAPI> {
  const maxDepth = options?.maxDepth ?? 2

  let schema: IntrospectionSchema
  let endpoint: string

  if (typeof input === 'string') {
    if (!input.startsWith('http')) {
      throw new ApiInvokeError({
        kind: ErrorKind.PARSE,
        message: 'GraphQL input must be an endpoint URL (starting with http) or an introspection JSON object. SDL parsing is not yet supported.',
        suggestion: 'Pass a URL like "https://api.example.com/graphql" or an introspection result object.',
        retryable: false,
      })
    }
    endpoint = options?.endpoint ?? input
    schema = await fetchIntrospection(input, options?.fetch)
  } else {
    schema = extractSchema(input)
    endpoint = options?.endpoint ?? '/graphql'
  }

  const path = extractPath(endpoint)
  const typeMap = buildTypeMap(schema.types)
  const operations: Operation[] = []

  // Parse query fields
  if (schema.queryType?.name) {
    const queryType = typeMap.get(schema.queryType.name)
    if (queryType?.fields) {
      for (const field of queryType.fields) {
        operations.push(buildOperation(field, 'query', path, typeMap, maxDepth))
      }
    }
  }

  // Parse mutation fields
  if (schema.mutationType?.name) {
    const mutationType = typeMap.get(schema.mutationType.name)
    if (mutationType?.fields) {
      for (const field of mutationType.fields) {
        operations.push(buildOperation(field, 'mutation', path, typeMap, maxDepth))
      }
    }
  }

  // Parse subscription fields — tagged for discovery but not executable via HTTP (subscriptions require WebSocket). No buildBody hook is set.
  if (schema.subscriptionType?.name) {
    const subType = typeMap.get(schema.subscriptionType.name)
    if (subType?.fields) {
      for (const field of subType.fields) {
        operations.push(buildOperation(field, 'subscription', path, typeMap, maxDepth))
      }
    }
  }

  const title = extractTitle(endpoint, schema)

  return {
    title,
    version: '1.0.0',
    baseUrl: extractBaseUrl(endpoint),
    operations,
    authSchemes: [],
    specFormat: SpecFormat.GRAPHQL,
  }
}

/** Run an introspection query against a live GraphQL endpoint. */
async function fetchIntrospection(
  url: string,
  fetchFn?: typeof globalThis.fetch,
): Promise<IntrospectionSchema> {
  const doFetch = fetchFn ?? globalThis.fetch
  let response: Response
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: INTROSPECTION_QUERY }),
    })
  } catch (err) {
    throw new ApiInvokeError({
      kind: ErrorKind.NETWORK,
      message: `Failed to fetch GraphQL introspection from ${url}: ${err instanceof Error ? err.message : String(err)}`,
      suggestion: 'Check the endpoint URL and your network connection.',
      retryable: true,
    })
  }

  if (!response.ok) {
    throw new ApiInvokeError({
      kind: ErrorKind.HTTP,
      message: `GraphQL introspection failed with HTTP ${response.status} from ${url}.`,
      suggestion: 'Verify the endpoint supports introspection and is accessible.',
      retryable: response.status >= 500,
      status: response.status,
    })
  }

  let json: Record<string, unknown>
  const cloned = response.clone()
  try {
    json = await response.json() as Record<string, unknown>
  } catch (err) {
    let body: string | undefined
    try { body = (await cloned.text()).slice(0, 200) } catch { /* ignore */ }
    throw new ApiInvokeError({
      kind: ErrorKind.PARSE,
      message: `GraphQL introspection response from ${url} is not valid JSON${err instanceof Error ? `: ${err.message}` : ''}.`,
      suggestion: `The endpoint returned a non-JSON response${body ? ` (starts with: "${body}")` : ''}. Verify it is a GraphQL endpoint.`,
      retryable: false,
    })
  }
  return extractSchema(json)
}

/** Extract __schema from an introspection result object. */
function extractSchema(obj: object): IntrospectionSchema {
  const record = obj as Record<string, unknown>

  // Shape: { __schema: ... }
  if (record.__schema && typeof record.__schema === 'object') {
    return record.__schema as IntrospectionSchema
  }

  // Shape: { data: { __schema: ... } }
  if (record.data && typeof record.data === 'object') {
    const data = record.data as Record<string, unknown>
    if (data.__schema && typeof data.__schema === 'object') {
      return data.__schema as IntrospectionSchema
    }
  }

  throw new ApiInvokeError({
    kind: ErrorKind.PARSE,
    message: 'Invalid GraphQL introspection result: expected { __schema: ... } or { data: { __schema: ... } }.',
    suggestion: 'Pass a valid introspection result object or a URL to a GraphQL endpoint.',
    retryable: false,
  })
}

/** Build a type lookup map from introspection types. */
function buildTypeMap(types: IntrospectionType[]): Map<string, IntrospectionType> {
  const map = new Map<string, IntrospectionType>()
  for (const type of types) {
    map.set(type.name, type)
  }
  return map
}

/** Extract URL path from an endpoint URL. */
function extractPath(endpoint: string): string {
  try {
    return new URL(endpoint).pathname
  } catch {
    return '/graphql'
  }
}

/** Extract base URL (origin) from an endpoint URL. */
function extractBaseUrl(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return url.origin
  } catch {
    return ''
  }
}

/** Generate a title from the endpoint URL or schema info. */
function extractTitle(endpoint: string, _schema: IntrospectionSchema): string {
  try {
    const url = new URL(endpoint)
    return `GraphQL API (${url.hostname})`
  } catch {
    return 'GraphQL API'
  }
}

/** Build an Operation from an introspection field. */
function buildOperation(
  field: IntrospectionField,
  operationType: 'query' | 'mutation' | 'subscription',
  path: string,
  typeMap: Map<string, IntrospectionType>,
  maxDepth: number,
): Operation {
  const id = operationType === 'mutation' ? `mutation_${field.name}`
           : operationType === 'subscription' ? `subscription_${field.name}`
           : field.name
  const tags = [operationType]

  const queryString = operationType !== 'subscription'
    ? buildQueryString(operationType as 'query' | 'mutation', field, typeMap, maxDepth)
    : undefined

  const requestBody = buildRequestBody(field.args, typeMap)
  const responseSchema = buildResponseSchema(field.type, typeMap)

  const operation: Operation = {
    id,
    path,
    method: HttpMethod.POST,
    summary: field.description ?? `GraphQL ${operationType}: ${field.name}`,
    parameters: [],
    requestBody,
    responseSchema,
    tags,
  }

  if (queryString) {
    const argNames = new Set(field.args.map(a => a.name))
    operation.buildBody = (args: Record<string, unknown>) => {
      const variables: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(args)) {
        if (argNames.has(k)) variables[k] = v
      }
      return { query: queryString, variables }
    }
  }

  return operation
}

/** Build a RequestBody from GraphQL field arguments. */
function buildRequestBody(
  args: IntrospectionInputValue[],
  typeMap: Map<string, IntrospectionType>,
): RequestBody | undefined {
  if (args.length === 0) return undefined

  const properties: Record<string, RequestBodyProperty> = {}
  const required: string[] = []

  for (const arg of args) {
    properties[arg.name] = mapInputValueToProperty(arg, typeMap)
    if (isNonNull(arg.type)) {
      required.push(arg.name)
    }
  }

  return {
    required: required.length > 0,
    contentType: ContentType.JSON,
    schema: {
      type: 'object',
      raw: { type: 'object', properties },
      properties,
      required: required.length > 0 ? required : undefined,
    },
  }
}

/** Map a GraphQL input value to a RequestBodyProperty. */
function mapInputValueToProperty(
  input: IntrospectionInputValue,
  typeMap: Map<string, IntrospectionType>,
): RequestBodyProperty {
  const base = unwrapType(input.type)
  const description = input.description
    ? `${input.description} (${formatTypeRef(input.type)})`
    : formatTypeRef(input.type)

  // Check if the type ref has a LIST wrapper in its chain
  const isList = isListType(input.type)

  if (base.kind === TypeKind.SCALAR) {
    const mapped = mapScalarType(base.name ?? 'String')
    const prop: RequestBodyProperty = {
      type: isList ? 'array' : mapped.type,
      description,
    }
    if (mapped.format) prop.format = mapped.format
    if (input.defaultValue != null) prop.default = input.defaultValue
    return prop
  }

  if (base.kind === TypeKind.ENUM) {
    const enumType = typeMap.get(base.name ?? '')
    const enumValues = enumType?.enumValues?.map(e => e.name)
    return {
      type: isList ? 'array' : 'string',
      description,
      enum: enumValues,
    }
  }

  if (base.kind === TypeKind.INPUT_OBJECT) {
    return {
      type: isList ? 'array' : 'object',
      description,
      nested: true,
    }
  }

  // Fallback for unknown types
  return { type: 'string', description }
}

/** Check if a type ref contains a LIST wrapper. */
function isListType(ref: IntrospectionTypeRef): boolean {
  let current: IntrospectionTypeRef | null | undefined = ref
  while (current) {
    if (current.kind === TypeKind.LIST) return true
    current = current.ofType
  }
  return false
}

/** Map a GraphQL scalar type name to a JSON Schema type. */
function mapScalarType(name: string): { type: string; format?: string } {
  switch (name) {
    case 'String':
    case 'ID':
      return { type: 'string' }
    case 'Int':
      return { type: 'integer' }
    case 'Float':
      return { type: 'number' }
    case 'Boolean':
      return { type: 'boolean' }
    default:
      // Custom scalars (DateTime, JSON, etc.) → string
      return { type: 'string', format: name.toLowerCase() }
  }
}

/** Build a response schema from the field's return type. */
function buildResponseSchema(
  typeRef: IntrospectionTypeRef,
  typeMap: Map<string, IntrospectionType>,
): unknown {
  const base = unwrapType(typeRef)
  if (!base.name) return undefined

  if (base.kind === TypeKind.SCALAR) {
    const mapped = mapScalarType(base.name)
    return { type: mapped.type, format: mapped.format }
  }

  if (base.kind === TypeKind.ENUM) {
    const enumType = typeMap.get(base.name)
    return { type: 'string', enum: enumType?.enumValues?.map(e => e.name) }
  }

  if (base.kind === TypeKind.OBJECT) {
    const objType = typeMap.get(base.name)
    if (!objType?.fields) return { type: 'object' }

    const properties: Record<string, unknown> = {}
    for (const f of objType.fields) {
      const fieldBase = unwrapType(f.type)
      if (fieldBase.kind === TypeKind.SCALAR) {
        properties[f.name] = mapScalarType(fieldBase.name ?? 'String')
      } else if (fieldBase.kind === TypeKind.ENUM) {
        properties[f.name] = { type: 'string' }
      } else {
        properties[f.name] = { type: 'object' }
      }
    }
    return { type: 'object', properties }
  }

  return { type: 'object' }
}
