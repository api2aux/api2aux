/**
 * Response formatting with configurable merge strategies.
 *
 * Three strategies for combining tool results into a structured response:
 * - Array: Return each result separately (simplest)
 * - LLM-guided: Use an extra LLM call to merge (most intelligent)
 * - Schema-based: Merge deterministically by shared entity IDs (no LLM call)
 */

import type { ToolResultEntry, StructuredResponse, LLMCompletionFn, ChatMessage } from './types'
import { MergeStrategy, MessageRole } from './types'

// ── ID field detection for schema-based merge ──

const ID_FIELD_PATTERNS = new Set(['id', '_id', 'uuid', 'slug', 'key', 'identifier'])

function isIdField(name: string): boolean {
  const lower = name.toLowerCase()
  return ID_FIELD_PATTERNS.has(lower) || lower.endsWith('_id') || /(?:^|[a-z])Id$/.test(name)
}

/** Extract ID-like fields from a data object. */
function extractIdFields(data: unknown): Map<string, unknown> {
  const ids = new Map<string, unknown>()
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ids

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (isIdField(key) && value !== null && value !== undefined) {
      ids.set(key, value)
    }
  }
  return ids
}

/** Normalize an array or single item into an array of objects. */
function normalizeToArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(item => item && typeof item === 'object') as Record<string, unknown>[]
  }
  if (data && typeof data === 'object') {
    return [data as Record<string, unknown>]
  }
  return []
}

// ── Merge Strategies ──

/** Array strategy: return each tool result separately. */
function mergeArray(toolResults: ToolResultEntry[]): StructuredResponse {
  return {
    strategy: MergeStrategy.Array,
    sources: toolResults.map(r => ({ toolName: r.toolName, args: r.toolArgs })),
    data: toolResults.map(r => r.data),
  }
}

/** Schema-based strategy: merge by shared entity IDs. */
function mergeSchemaBased(toolResults: ToolResultEntry[]): StructuredResponse {
  // Collect all entities across results, grouped by their ID values
  const entityMap = new Map<string, Record<string, unknown>>()

  for (const result of toolResults) {
    const items = normalizeToArray(result.data)
    for (const item of items) {
      const ids = extractIdFields(item)
      if (ids.size === 0) continue

      // Use the first ID field's value as the entity key
      const [idField, idValue] = [...ids.entries()][0]!
      const entityKey = `${idField}:${String(idValue)}`

      const existing = entityMap.get(entityKey)
      if (existing) {
        // Merge fields from this result into the existing entity
        Object.assign(existing, item)
      } else {
        entityMap.set(entityKey, { ...item })
      }
    }
  }

  // If no entities with ID fields were found, fall back to array strategy
  if (entityMap.size === 0) {
    return mergeArray(toolResults)
  }

  return {
    strategy: MergeStrategy.SchemaBased,
    sources: toolResults.map(r => ({ toolName: r.toolName, args: r.toolArgs })),
    data: [...entityMap.values()],
  }
}

const MERGE_PROMPT = `You are a data merging assistant. Given the following API results, merge them into a single JSON document that best answers the user's question. Select the most relevant entities and fields. Return ONLY valid JSON, nothing else.`

/**
 * LLM-guided strategy: use an extra LLM call to merge results.
 * Falls back to array strategy if the LLM call fails or returns invalid JSON.
 */
async function mergeLlmGuided(
  toolResults: ToolResultEntry[],
  userMessage: string,
  llm: LLMCompletionFn,
): Promise<StructuredResponse> {
  if (toolResults.length === 0) {
    return mergeArray(toolResults)
  }

  const resultsText = toolResults
    .map((r, i) => {
      let dataStr: string
      try {
        dataStr = JSON.stringify(r.data, null, 2).slice(0, 4000)
      } catch (err) {
        console.warn('[chat-engine] Failed to serialize tool result for merge prompt:', err instanceof Error ? err.message : String(err))
        dataStr = '[Unserializable data]'
      }
      return `Result ${i + 1} (from ${r.toolName}):\n${dataStr}`
    })
    .join('\n\n')

  const messages: ChatMessage[] = [
    { role: MessageRole.System, content: MERGE_PROMPT },
    { role: MessageRole.User, content: `User's question: ${userMessage}\n\n${resultsText}` },
  ]

  try {
    const result = await llm(messages, [], () => {})
    const parsed = JSON.parse(result.content)
    return {
      strategy: MergeStrategy.LlmGuided,
      sources: toolResults.map(r => ({ toolName: r.toolName, args: r.toolArgs })),
      data: parsed,
    }
  } catch (err) {
    console.warn(
      '[chat-engine] LLM-guided merge failed, falling back to array strategy:',
      err instanceof Error ? err.message : String(err),
    )
    return mergeArray(toolResults)
  }
}

// ── Public API ──

/**
 * Format a structured response from collected tool results.
 *
 * The response's `strategy` reflects what was actually applied, which may
 * differ from the requested strategy if a fallback occurred:
 * - LlmGuided falls back to Array on LLM failure
 * - SchemaBased falls back to Array when no entities with ID fields are detected
 */
export async function formatStructuredResponse(
  toolResults: ToolResultEntry[],
  strategy: typeof MergeStrategy.LlmGuided,
  userMessage: string,
  llm: LLMCompletionFn,
): Promise<StructuredResponse>
export async function formatStructuredResponse(
  toolResults: ToolResultEntry[],
  strategy?: typeof MergeStrategy.Array | typeof MergeStrategy.SchemaBased,
): Promise<StructuredResponse>
export async function formatStructuredResponse(
  toolResults: ToolResultEntry[],
  strategy: MergeStrategy,
  userMessage: string,
  llm: LLMCompletionFn,
): Promise<StructuredResponse>
export async function formatStructuredResponse(
  toolResults: ToolResultEntry[],
  strategy: MergeStrategy = MergeStrategy.LlmGuided,
  userMessage?: string,
  llm?: LLMCompletionFn,
): Promise<StructuredResponse> {
  if (toolResults.length === 0) {
    return mergeArray(toolResults)
  }

  switch (strategy) {
    case MergeStrategy.Array:
      return mergeArray(toolResults)

    case MergeStrategy.SchemaBased:
      return mergeSchemaBased(toolResults)

    case MergeStrategy.LlmGuided:
      if (llm && userMessage) {
        return mergeLlmGuided(toolResults, userMessage, llm)
      }
      console.warn(
        '[chat-engine] LLM-guided merge requested but llm/userMessage not provided; falling back to array strategy',
      )
      return mergeArray(toolResults)

    default:
      return mergeArray(toolResults)
  }
}
