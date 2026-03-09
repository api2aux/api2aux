/**
 * Minimal operation interface for tool generation.
 * Satisfied by api-bridge-rt's Operation via structural typing.
 */
export interface ToolOperation {
  id: string
  path: string
  method: string
  summary?: string
  description?: string
  tags: string[]
  responseSchema?: unknown
}

export interface DescriptionOptions {
  /** Include "METHOD /path" line after summary (used by chat for LLM context) */
  includePath?: boolean
}

// ── Unified Tool Definition types ───────────────────────────────────

export const ParameterIn = {
  Query: 'query',
  Path: 'path',
  Header: 'header',
  Cookie: 'cookie',
  Body: 'body',
} as const

export type ParameterIn = typeof ParameterIn[keyof typeof ParameterIn]

export interface ToolParameterSchema {
  type: string
  format?: string
  enum?: unknown[]
  default?: unknown
  example?: unknown
  minimum?: number
  maximum?: number
  maxLength?: number
}

export interface ToolParameter {
  name: string
  in: ParameterIn
  required: boolean
  description: string
  schema: ToolParameterSchema
}

export interface ToolRequestBody {
  required: boolean
  description?: string
}

/** Operation with full parameter info, for unified tool generation. */
export interface ToolOperationWithParams extends ToolOperation {
  parameters: ToolParameter[]
  requestBody?: ToolRequestBody
}

export interface JsonSchemaProperty {
  type: string
  description?: string
  enum?: string[]
  default?: unknown
  minimum?: number
  maximum?: number
  maxLength?: number
}

/** Canonical tool definition — single source of truth for all consumers. */
export interface UnifiedToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, JsonSchemaProperty>
    required?: string[]
  }
}
