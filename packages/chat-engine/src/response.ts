/**
 * Response formatting with configurable merge strategies.
 *
 * Three strategies for combining tool results into a structured response:
 * - Array: Return each result separately (simplest)
 * - LLM-guided: Use an extra LLM call to merge or focus results (most flexible)
 * - Schema-based: Merge deterministically by shared entity IDs (no LLM call)
 */

import type { ToolResultEntry, StructuredResponse, LLMTextFn, ChatMessage } from './types'
import { MergeStrategy, MessageRole } from './types'

// ── Focus result cache ──

const focusCache = new Map<string, unknown>()

/** Clear the focus result cache (call on API switch or user request). */
export function clearFocusCache(): void {
  focusCache.clear()
}

// ── JSON extraction helper ──

/**
 * Attempt to extract valid JSON from LLM output that may contain
 * markdown code blocks, surrounding text, or other formatting.
 * Returns the parsed value on success, null if no valid JSON found.
 */
export function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim()
  try { return JSON.parse(trimmed) } catch {}

  // Markdown code block: ```json ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]!) } catch {}
  }

  // Outermost { } or [ ]
  const start = trimmed.search(/[{[]/)
  if (start >= 0) {
    const closer = trimmed[start] === '{' ? '}' : ']'
    const end = trimmed.lastIndexOf(closer)
    if (end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)) } catch {}
    }
  }

  return null
}

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
    sources: toolResults.map(r => ({ toolName: r.toolName, toolArgs: r.toolArgs })),
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
    sources: toolResults.map(r => ({ toolName: r.toolName, toolArgs: r.toolArgs })),
    data: [...entityMap.values()],
  }
}

const MERGE_PROMPT = `You are a data merging assistant. Given the following API results, merge them into a single JSON document. Include ALL items from each result that are relevant to the user's question. Preserve key fields needed for comparison or display. Return ONLY valid JSON, nothing else.`

const FOCUS_PROMPT = `You are a data assistant. Given the following API result and the user's question, extract only the items that are relevant to the question. Keep all fields for each matching item. Return ONLY valid JSON, nothing else.`

/**
 * LLM-guided strategy: use an extra LLM call to merge multiple results or focus a single result.
 * LLM infrastructure errors (network, auth, rate limit) propagate to the caller.
 * Falls back to array strategy if the LLM returns invalid JSON.
 */
async function mergeLlmGuided(
  toolResults: ToolResultEntry[],
  userMessage: string,
  llm: LLMTextFn,
  reducedResults?: ToolResultEntry[],
): Promise<StructuredResponse> {
  const prompt = toolResults.length === 1 ? FOCUS_PROMPT : MERGE_PROMPT

  // Use pre-reduced results if available (from reduceToolResultsForFocus)
  const effectiveResults = reducedResults ?? toolResults

  const resultsText = effectiveResults
    .map((r, i) => {
      let dataStr: string
      try {
        dataStr = JSON.stringify(r.data)
      } catch (err) {
        console.warn('[chat-engine] Failed to serialize tool result for merge prompt:', err instanceof Error ? err.message : String(err))
        dataStr = '[Unserializable data]'
      }
      return `Result ${i + 1} (from ${r.toolName}):\n${dataStr}`
    })
    .join('\n\n')

  // Check focus cache — same query + same data = same focused result
  const focusKey = `${userMessage}::${resultsText.slice(0, 500)}`
  const cachedFocus = focusCache.get(focusKey)
  if (cachedFocus !== undefined) {
    return {
      strategy: MergeStrategy.LlmGuided,
      sources: toolResults.map(r => ({ toolName: r.toolName, toolArgs: r.toolArgs })),
      data: cachedFocus,
    }
  }

  const messages: ChatMessage[] = [
    { role: MessageRole.System, content: prompt },
    { role: MessageRole.User, content: `User's question: ${userMessage}\n\n${resultsText}` },
  ]

  // Separate LLM call from JSON parse so infrastructure errors propagate
  // while malformed LLM output falls back gracefully.
  let content: string
  try {
    content = await llm(messages)
  } catch (err) {
    // LLM infrastructure error (network, auth, rate limit) — let it propagate
    // so the caller can handle it visibly rather than silently degrading.
    throw err
  }

  const parsed = extractJson(content)
  if (parsed !== null) {
    focusCache.set(focusKey, parsed)
    return {
      strategy: MergeStrategy.LlmGuided,
      sources: toolResults.map(r => ({ toolName: r.toolName, toolArgs: r.toolArgs })),
      data: parsed,
    }
  }

  console.warn('[chat-engine] LLM merge returned unparseable content, falling back to array strategy')
  return mergeArray(toolResults)
}

// ── Public API ──

/**
 * Format a structured response from collected tool results.
 *
 * The response's `strategy` reflects what was actually applied, which may
 * differ from the requested strategy if a fallback occurred:
 * - LlmGuided falls back to Array on invalid JSON from the LLM
 * - SchemaBased falls back to Array when no entities with ID fields are detected
 */
export async function formatStructuredResponse(
  toolResults: ToolResultEntry[],
  strategy: typeof MergeStrategy.LlmGuided,
  userMessage: string,
  llm: LLMTextFn,
  reducedResults?: ToolResultEntry[],
): Promise<StructuredResponse>
export async function formatStructuredResponse(
  toolResults: ToolResultEntry[],
  strategy?: typeof MergeStrategy.Array | typeof MergeStrategy.SchemaBased,
): Promise<StructuredResponse>
export async function formatStructuredResponse(
  toolResults: ToolResultEntry[],
  strategy: MergeStrategy,
  userMessage: string,
  llm: LLMTextFn,
  reducedResults?: ToolResultEntry[],
): Promise<StructuredResponse>
export async function formatStructuredResponse(
  toolResults: ToolResultEntry[],
  strategy: MergeStrategy = MergeStrategy.LlmGuided,
  userMessage?: string,
  llm?: LLMTextFn,
  reducedResults?: ToolResultEntry[],
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
        return mergeLlmGuided(toolResults, userMessage, llm, reducedResults)
      }
      console.warn(
        '[chat-engine] LLM-guided merge requested but llm/userMessage not provided; falling back to array strategy',
      )
      return mergeArray(toolResults)

    default: {
      const _exhaustive: never = strategy
      console.error('[chat-engine] Unknown merge strategy:', _exhaustive)
      return mergeArray(toolResults)
    }
  }
}

/** True when structured data used a non-Array strategy and the resulting data is non-empty. */
export function hasUsableStructuredData(
  s: StructuredResponse,
): s is Exclude<StructuredResponse, { strategy: typeof MergeStrategy.Array }> {
  if (s.strategy === MergeStrategy.Array) return false
  const { data } = s
  if (data == null) return false
  if (Array.isArray(data) && data.length === 0) return false
  if (typeof data === 'object' && !Array.isArray(data) && Object.keys(data as object).length === 0) return false
  return true
}
