/**
 * Converts the current API URL or OpenAPI spec into LLM tool definitions.
 * These tools let the LLM make API calls on behalf of the user.
 */

import type { Tool, ToolParameter } from './types'
import type { ParsedSpec } from '../openapi/types'
import { parseUrlParameters } from '../urlParser/parser'

/**
 * Build tools from a raw API URL (non-OpenAPI).
 * Creates a single tool that queries the API with optional path and query params.
 */
export function buildToolsFromUrl(url: string): Tool[] {
  const parsedUrl = new URL(url)
  const hostname = parsedUrl.hostname.replace(/^(www|api)\./, '')
  const { parameters } = parseUrlParameters(url)

  const pathname = parsedUrl.pathname.replace(/\/$/, '')
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${pathname}`

  const properties: Record<string, ToolParameter> = {
    path: {
      type: 'string',
      description: `Optional sub-path to append AFTER the base path "${pathname}". For example "/1" to get item by ID, or "/search" for a search endpoint. Do NOT repeat "${pathname}" — it is already included. Omit this parameter to call the base URL as-is.`,
    },
  }

  for (const param of parameters) {
    properties[param.name] = {
      type: 'string',
      description: `Query parameter: ${param.name}`,
      ...(param.values?.[0] ? { default: param.values[0] } : {}),
    }
  }

  return [{
    type: 'function',
    function: {
      name: 'query_api',
      description: `Query the REST API at ${hostname}. The base URL is ${baseUrl}. You can append path segments and set query parameters to filter or navigate the data.`,
      parameters: {
        type: 'object',
        properties,
      },
    },
  }]
}

/**
 * Build tools from a parsed OpenAPI spec.
 * Creates one tool per operation.
 */
export function buildToolsFromSpec(spec: ParsedSpec): Tool[] {
  return spec.operations.map(op => {
    const properties: Record<string, ToolParameter> = {}
    const required: string[] = []

    for (const param of op.parameters) {
      properties[param.name] = {
        type: param.schema?.type === 'integer' || param.schema?.type === 'number' ? 'number' : 'string',
        description: param.description || `${param.in} parameter: ${param.name}`,
        ...(param.schema?.enum ? { enum: param.schema.enum.map(String) } : {}),
      }
      if (param.required) {
        required.push(param.name)
      }
    }

    if (op.requestBody) {
      properties['body'] = {
        type: 'string',
        description: 'Request body as JSON string',
      }
    }

    const name = sanitizeToolName(op.operationId || `${op.method}_${op.path}`)
    const description = [op.summary, op.description].filter(Boolean).join('. ') ||
      `${op.method.toUpperCase()} ${op.path}`

    return {
      type: 'function' as const,
      function: {
        name,
        description,
        parameters: {
          type: 'object' as const,
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
      },
    }
  })
}

function sanitizeToolName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 64)
}

/**
 * Build the system prompt that describes the API and instructs the LLM.
 */
export function buildSystemPrompt(url: string, spec?: ParsedSpec | null): string {
  const hostname = new URL(url).hostname

  if (spec) {
    return [
      `You are a helpful assistant that queries the "${spec.title}" API (${spec.baseUrl}) on behalf of the user.`,
      `The API has ${spec.operations.length} operations available as tools.`,
      `IMPORTANT: You MUST always call a tool to answer the user's question. NEVER answer from your own knowledge.`,
      `Your role is to fetch real-time data from the API, not to provide information you already know.`,
      `Even if you know the answer, call the relevant API tool so the UI updates with fresh data.`,
      `When the user asks a question, determine which API operation to call, execute it, then summarize the results concisely (2-3 sentences).`,
    ].join(' ')
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
