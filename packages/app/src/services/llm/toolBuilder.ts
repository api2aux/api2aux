/**
 * Converts the current API URL or OpenAPI spec into LLM tool definitions.
 * These tools let the LLM make API calls on behalf of the user.
 *
 * Uses @api2aux/tool-utils as the single source of truth for tool definitions,
 * with a thin adapter to convert UnifiedToolDefinition → OpenAI Tool format.
 */

import type { Tool } from './types'
import type { ParsedAPI, OperationContext, OperationContextParam } from '@api2aux/semantic-analysis'
import { enrichmentRegistry } from '@api2aux/semantic-analysis'
import { analyzeWorkflows } from '@api2aux/workflow-inference'
import { parseUrlParameters } from '../urlParser/parser'
import {
  sanitizeToolName,
  generateToolName,
  generateToolDefinitions,
  generateRawUrlToolDefinition,
} from '@api2aux/tool-utils'
import type { UnifiedToolDefinition } from '@api2aux/tool-utils'

/** Convert a UnifiedToolDefinition to the OpenAI function-calling Tool format. */
function unifiedToOpenAI(def: UnifiedToolDefinition): Tool {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    },
  }
}

/**
 * Build tools from a raw API URL (non-OpenAPI).
 */
export function buildToolsFromUrl(url: string): Tool[] {
  const { parameters } = parseUrlParameters(url)
  const def = generateRawUrlToolDefinition(url, parameters)
  return [unifiedToOpenAI(def)]
}

/** Convert a ParsedAPI operation to an OperationContext for enrichment plugins. */
function toOperationContext(op: ParsedAPI['operations'][number]): OperationContext {
  const params: OperationContextParam[] = op.parameters.map(p => ({
    name: p.name,
    in: p.in,
    type: p.schema.type,
    format: p.schema.format,
    required: p.required,
  }))
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

/**
 * Build tools from a parsed OpenAPI spec.
 * Passes enrichment plugin hints through to tool definitions.
 */
export function buildToolsFromSpec(spec: ParsedAPI): Tool[] {
  const opContexts = spec.operations.map(toOperationContext)
  let enrichHints: Map<string, import('@api2aux/semantic-analysis').ToolEnrichmentHint> | undefined
  try {
    enrichHints = enrichmentRegistry.getToolHints(opContexts)
  } catch (err) {
    console.error('[toolBuilder] Enrichment plugin hints failed:', err instanceof Error ? err.message : err)
  }
  const defs = generateToolDefinitions(spec.operations, { includePath: true }, enrichHints)
  return defs.map(unifiedToOpenAI)
}

function buildToolCatalog(spec: ParsedAPI): string | null {
  if (spec.operations.length <= 10) return null // Not needed for small APIs

  const tagMap = new Map<string, string[]>()
  for (const op of spec.operations) {
    const tags = op.tags.length > 0 ? op.tags : ['Other']
    const toolName = sanitizeToolName(op.id || `${op.method}_${op.path}`)
    for (const tag of tags) {
      const list = tagMap.get(tag) || []
      list.push(toolName)
      tagMap.set(tag, list)
    }
  }

  const lines = ['Tool categories:']
  for (const [tag, tools] of tagMap) {
    lines.push(`- ${tag} (${tools.length}): ${tools.join(', ')}`)
  }
  return lines.join('\n')
}

// ── Option 1: Smart System Prompt helpers ────────────────────────────

const PAGINATION_PARAM_NAMES = new Set([
  'page', 'limit', 'offset', 'per_page', 'perpage', 'page_size', 'pagesize',
  'cursor', 'skip', 'take', 'after', 'before', 'count', 'size',
])

const SEARCH_PARAM_NAMES = new Set([
  'q', 'query', 'search', 'filter', 'keyword', 'keywords', 'term', 'text',
])

/** Detect auth schemes and produce a system prompt hint. */
function detectAuthContext(spec: ParsedAPI): string | null {
  if (!spec.authSchemes || spec.authSchemes.length === 0) return null

  const types = [...new Set(spec.authSchemes.map(s => s.authType).filter(Boolean))]
  if (types.length === 0) return null

  const typeLabels = types.map(t => {
    switch (t) {
      case 'bearer': return 'Bearer token'
      case 'basic': return 'Basic (username/password)'
      case 'apiKey': return 'API key'
      case 'oauth2': return 'OAuth2'
      case 'cookie': return 'Cookie-based'
      default: return String(t)
    }
  })

  return `Authentication: This API uses ${typeLabels.join(' / ')} auth. If API calls return 401/403, remind the user to configure authentication in the settings.`
}

/** Detect pagination parameters and produce a system prompt hint. */
function detectPaginationHints(spec: ParsedAPI): string | null {
  const paginationParams = new Map<string, { default?: unknown; maximum?: unknown }>()

  for (const op of spec.operations) {
    for (const param of op.parameters) {
      const lower = param.name.toLowerCase()
      if (PAGINATION_PARAM_NAMES.has(lower)) {
        if (!paginationParams.has(param.name)) {
          paginationParams.set(param.name, {
            default: param.schema.default,
            maximum: param.schema.maximum,
          })
        }
      }
    }
  }

  if (paginationParams.size === 0) return null

  const details: string[] = []
  for (const [name, info] of paginationParams) {
    let detail = name
    if (info.default !== undefined) detail += ` (default: ${info.default})`
    if (info.maximum !== undefined) detail += ` (max: ${info.maximum})`
    details.push(detail)
  }

  return `Pagination: This API uses ${details.join(', ')} for pagination. When users ask for "all data" or "more results", increase the limit or paginate through pages.`
}

/** Detect search/filter parameters and produce a system prompt hint. */
function detectSearchHints(spec: ParsedAPI): string | null {
  const searchOps: { toolName: string; searchParam: string; filterParams: string[] }[] = []

  for (const op of spec.operations) {
    let searchParam: string | null = null
    const filterParams: string[] = []

    for (const param of op.parameters) {
      const lower = param.name.toLowerCase()
      if (SEARCH_PARAM_NAMES.has(lower)) {
        searchParam = param.name
      } else if (param.in === 'query' && !PAGINATION_PARAM_NAMES.has(lower)) {
        filterParams.push(param.name)
      }
    }

    if (searchParam) {
      searchOps.push({
        toolName: generateToolName(op),
        searchParam,
        filterParams,
      })
    }
  }

  if (searchOps.length === 0) return null

  const lines = ['Search capabilities:']
  for (const { toolName, searchParam, filterParams } of searchOps) {
    let line = `- ${toolName}: use '${searchParam}' for text search`
    if (filterParams.length > 0) {
      line += `. Filters: ${filterParams.join(', ')}`
    }
    lines.push(line)
  }

  return lines.join('\n')
}

// ── Option 3: Full Semantic Layer helpers ────────────────────────────

/**
 * Detect workflows using the deterministic inference engine.
 * Replaces the hand-written pattern matching with multi-signal analysis.
 */
function detectWorkflows(spec: ParsedAPI): string | null {
  try {
    const pluginPatterns = enrichmentRegistry.getWorkflowPatterns()
    const { workflows } = analyzeWorkflows(spec.operations, {
      pluginPatterns: pluginPatterns.length > 0 ? pluginPatterns : undefined,
    })

    if (workflows.length === 0) return null

    const lines = ['Common workflows:']
    for (const wf of workflows.slice(0, 8)) {
      const steps = wf.steps.map(s => s.operationId).join(' → ')
      lines.push(`- ${wf.name}: ${steps}`)
    }
    return lines.join('\n')
  } catch (err) {
    console.error('[toolBuilder] Workflow detection failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Extract semantic highlights from response schema fields. */
function detectResponseSemantics(spec: ParsedAPI): string | null {
  const ID_NAMES = new Set(['id', '_id', 'uuid', 'slug'])
  const URL_NAMES = new Set(['url', 'link', 'href', 'uri', 'website', 'homepage'])
  const DATE_NAMES = new Set(['created_at', 'createdat', 'updated_at', 'updatedat', 'date', 'timestamp'])

  const semantics = new Map<string, Set<string>>() // category → field names

  for (const op of spec.operations) {
    const schema = op.responseSchema
    if (!schema || typeof schema !== 'object') continue

    const s = schema as Record<string, unknown>
    let properties: Record<string, Record<string, unknown>> | null = null

    // Direct object
    if (s.type === 'object' && s.properties && typeof s.properties === 'object') {
      properties = s.properties as Record<string, Record<string, unknown>>
    }
    // Array of objects — unwrap
    if (s.type === 'array' && s.items && typeof s.items === 'object') {
      const items = s.items as Record<string, unknown>
      if (items.properties && typeof items.properties === 'object') {
        properties = items.properties as Record<string, Record<string, unknown>>
      }
    }
    // List wrapper — unwrap (e.g. { items: [{...}], total })
    if (properties && Object.keys(properties).length <= 4) {
      for (const prop of Object.values(properties)) {
        if (prop.type === 'array' && prop.items && typeof prop.items === 'object') {
          const inner = prop.items as Record<string, unknown>
          if (inner.properties && typeof inner.properties === 'object') {
            properties = inner.properties as Record<string, Record<string, unknown>>
            break
          }
        }
      }
    }

    if (!properties) continue

    for (const [name, prop] of Object.entries(properties)) {
      const lower = name.toLowerCase()
      const format = prop.format as string | undefined

      if (ID_NAMES.has(lower)) {
        const set = semantics.get('identifiers') || new Set()
        set.add(name)
        semantics.set('identifiers', set)
      } else if (URL_NAMES.has(lower) || format === 'uri' || format === 'url') {
        const set = semantics.get('URLs') || new Set()
        set.add(name)
        semantics.set('URLs', set)
      } else if (DATE_NAMES.has(lower) || format === 'date-time' || format === 'date') {
        const set = semantics.get('dates') || new Set()
        set.add(name)
        semantics.set('dates', set)
      }
    }
  }

  if (semantics.size === 0) return null

  const lines = ['Response field semantics:']
  for (const [category, fields] of semantics) {
    lines.push(`- ${category}: ${[...fields].join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * Build the system prompt that describes the API and instructs the LLM.
 */
export function buildSystemPrompt(url: string, spec?: ParsedAPI | null): string {
  const hostname = new URL(url).hostname

  if (spec) {
    const lines = [
      `You are a helpful assistant that queries the "${spec.title}" API (${spec.baseUrl}) on behalf of the user.`,
      `The API has ${spec.operations.length} operations available as tools.`,
      `IMPORTANT: You MUST always call a tool to answer the user's question. NEVER answer from your own knowledge.`,
      `Your role is to fetch real-time data from the API, not to provide information you already know.`,
      `Even if you know the answer, call the relevant API tool so the UI updates with fresh data.`,
      `You can call multiple tools in sequence if needed — for example, to compare data from two endpoints.`,
      `When the user asks a question, determine which API operation to call, execute it, then summarize the results concisely (2-3 sentences).`,
    ]

    // Semantic enrichment sections
    const sections: string[] = []

    const authHint = detectAuthContext(spec)
    if (authHint) sections.push(authHint)

    const paginationHint = detectPaginationHints(spec)
    if (paginationHint) sections.push(paginationHint)

    const searchHint = detectSearchHints(spec)
    if (searchHint) sections.push(searchHint)

    // Enrichment plugin operation tags
    const opContexts = spec.operations.map(toOperationContext)
    const opTags = enrichmentRegistry.tagOperations(opContexts)
    const taggedOps: string[] = []
    for (const [opId, tags] of opTags) {
      const highConf = tags.filter(t => t.confidence >= 0.7)
      if (highConf.length > 0) {
        taggedOps.push(`- ${opId}: ${highConf.map(t => t.label).join(', ')}`)
      }
    }
    if (taggedOps.length > 0) {
      sections.push('Operation semantics:\n' + taggedOps.join('\n'))
    }

    // Workflow detection
    const workflowHint = detectWorkflows(spec)
    if (workflowHint) sections.push(workflowHint)

    // Response field semantics
    const responseSemantics = detectResponseSemantics(spec)
    if (responseSemantics) sections.push(responseSemantics)

    // Navigation guidance for large APIs
    if (spec.operations.length > 10) {
      sections.push('Tip: When unsure which operation to use, start with list/search operations to explore available data, then drill into detail endpoints with specific IDs.')
    }

    // Add tag-grouped tool catalog for navigation
    const catalog = buildToolCatalog(spec)
    if (catalog) sections.push(catalog)

    const base = lines.join(' ')
    return sections.length > 0
      ? base + '\n\n' + sections.join('\n\n')
      : base
  }

  const parsedUrl = new URL(url)
  const pathname = parsedUrl.pathname.replace(/\/$/, '')

  return [
    `You are a helpful assistant that queries the REST API at ${hostname} on behalf of the user.`,
    `You have a "query_api" tool that fetches data from: ${parsedUrl.origin}${pathname}`,
    `The tool calls this exact endpoint — you can only adjust query parameters, not the URL path.`,
    `If the data you need isn't available through query parameter filtering, explain what the user could try instead.`,
    `IMPORTANT: You MUST always call the tool to answer the user's question. NEVER answer from your own knowledge.`,
    `Your role is to fetch real-time data from the API, not to provide information you already know.`,
    `Even if you know the answer, call the tool so the UI updates with fresh data.`,
    `After calling the tool, summarize the results concisely (2-3 sentences).`,
  ].join(' ')
}
