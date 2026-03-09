/**
 * Converts the current API URL or OpenAPI spec into LLM tool definitions.
 * These tools let the LLM make API calls on behalf of the user.
 *
 * Uses @api2aux/tool-utils as the single source of truth for tool definitions,
 * with a thin adapter to convert UnifiedToolDefinition → OpenAI Tool format.
 */

import type { Tool } from './types'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import { parseUrlParameters } from '../urlParser/parser'
import {
  sanitizeToolName,
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

/**
 * Build tools from a parsed OpenAPI spec.
 */
export function buildToolsFromSpec(spec: ParsedAPI): Tool[] {
  const defs = generateToolDefinitions(spec.operations, { includePath: true })
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

    // Add tag-grouped tool catalog for navigation
    const catalog = buildToolCatalog(spec)
    if (catalog) {
      return lines.join(' ') + '\n\n' + catalog
    }

    return lines.join(' ')
  }

  const parsedUrl = new URL(url)
  const pathname = parsedUrl.pathname.replace(/\/$/, '')

  return [
    `You are a helpful assistant that queries the REST API at ${hostname} on behalf of the user.`,
    `You have a "query_api" tool that can fetch data from this API.`,
    `The base URL is already set to ${parsedUrl.origin}${pathname} — do NOT repeat "${pathname}" in the path parameter.`,
    `The path parameter is only for SUB-paths like "/1" or "/search". To call the base URL as-is, omit the path parameter entirely.`,
    `IMPORTANT: You MUST always call the tool to answer the user's question. NEVER answer from your own knowledge.`,
    `Your role is to fetch real-time data from the API, not to provide information you already know.`,
    `Even if you know the answer, call the tool so the UI updates with fresh data.`,
    `After calling the tool, summarize the results concisely (2-3 sentences).`,
  ].join(' ')
}
