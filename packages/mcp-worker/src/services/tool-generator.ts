/**
 * Converts Operations into MCP tool definitions with Zod schemas.
 * Uses @api2aux/tool-utils as the single source of truth for tool definitions,
 * with a thin adapter to convert JSON Schema properties → Zod (required by MCP SDK).
 */

import { z } from 'zod'
import type { Operation } from '@api2aux/api-invoke'
import { generateToolDefinitions } from '@api2aux/tool-utils'
import type { JsonSchemaProperty, UnifiedToolDefinition } from '@api2aux/tool-utils'

export interface GeneratedTool {
  name: string
  description: string
  inputSchema: Record<string, z.ZodTypeAny>
  operation: Operation
}

/**
 * Convert a JSON Schema property to a Zod type.
 * Pure mechanical adapter — no domain logic.
 */
function jsonSchemaToZod(prop: JsonSchemaProperty, required: boolean): z.ZodTypeAny {
  let schema: z.ZodTypeAny

  switch (prop.type) {
    case 'number': {
      let numSchema = z.number()
      if (prop.minimum !== undefined) numSchema = numSchema.min(prop.minimum)
      if (prop.maximum !== undefined) numSchema = numSchema.max(prop.maximum)
      schema = numSchema
      break
    }
    case 'boolean':
      schema = z.boolean()
      break
    default: {
      if (prop.enum && prop.enum.length >= 2) {
        schema = z.enum(prop.enum as [string, string, ...string[]])
      } else {
        let strSchema = z.string()
        if (prop.maxLength) strSchema = strSchema.max(prop.maxLength)
        schema = strSchema
      }
      break
    }
  }

  if (prop.description) schema = schema.describe(prop.description)
  if (!required) schema = schema.optional()

  return schema
}

/**
 * Convert a UnifiedToolDefinition's input schema to a Zod shape.
 */
function unifiedToZodShape(def: UnifiedToolDefinition): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {}
  const requiredSet = new Set(def.inputSchema.required ?? [])

  for (const [name, prop] of Object.entries(def.inputSchema.properties)) {
    shape[name] = jsonSchemaToZod(prop, requiredSet.has(name))
  }

  return shape
}

export function generateTools(operations: Operation[]): GeneratedTool[] {
  const defs = generateToolDefinitions(operations)

  return defs.map((def, i) => ({
    name: def.name,
    description: def.description,
    inputSchema: unifiedToZodShape(def),
    operation: operations[i]!,
  }))
}
