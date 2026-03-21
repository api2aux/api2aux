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

const MERGE_PROMPT = `You are a data merging assistant. Given the following API results, merge them into a single JSON document that best answers the user's question. Select the most relevant entities and fields. Return ONLY valid JSON, nothing else.`

const FOCUS_PROMPT = `You are a data formatting assistant. Given the following API result, extract and organize the data that best answers the user's question into a single JSON document. Select the most relevant entities and fields. Return ONLY valid JSON, nothing else.`

// ── Embedding-based reduction ──

type EmbedFn = (texts: string[]) => Promise<number[][]>

/**
 * Reduce tool results with large arrays by selecting only the most
 * semantically relevant items via embedding similarity.
 *
 * Walks each tool result's data: if it contains an array with more than
 * `topK` items (directly or as an object property), the items are flattened
 * to text, embedded alongside the user's query, and the top-K most similar
 * items replace the original array.
 */
async function reduceWithEmbeddings(
  toolResults: ToolResultEntry[],
  userMessage: string,
  embedFn: EmbedFn,
  topK: number,
): Promise<ToolResultEntry[]> {
  const reduced: ToolResultEntry[] = []

  for (const result of toolResults) {
    const data = result.data
    const reducedData = await reduceData(data, userMessage, embedFn, topK)
    reduced.push(reducedData !== data ? { ...result, data: reducedData } : result)
  }

  return reduced
}

/** Reduce a data value — finds and shrinks large arrays. */
async function reduceData(
  data: unknown,
  query: string,
  embedFn: EmbedFn,
  topK: number,
): Promise<unknown> {
  // Direct array (e.g., [product1, product2, ...])
  if (Array.isArray(data) && data.length > topK) {
    return reduceArray(data, query, embedFn, topK)
  }

  // Object with array properties (e.g., { products: [...], total: 194 })
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    let changed = false
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value) && value.length > topK && value.length > 0 && typeof value[0] === 'object') {
        result[key] = await reduceArray(value, query, embedFn, topK)
        changed = true
      } else {
        result[key] = value
      }
    }

    return changed ? result : data
  }

  return data
}

/** Reduce an array to top-K items by embedding similarity to the query. */
async function reduceArray(
  items: unknown[],
  query: string,
  embedFn: EmbedFn,
  topK: number,
): Promise<unknown[]> {
  // Flatten each item to natural language text
  const itemTexts = items.map(item => flattenItemForEmbedding(item))

  // Embed query + all items in a single batch
  const allTexts = [query, ...itemTexts]
  let allVectors: number[][]
  try {
    allVectors = await embedFn(allTexts)
  } catch (err) {
    console.warn('[chat-engine] Embedding failed, skipping reduction:', err instanceof Error ? err.message : String(err))
    return items
  }

  const queryVector = allVectors[0]!
  const itemVectors = allVectors.slice(1)

  // Score and rank
  const scored = itemVectors.map((vec, i) => ({
    index: i,
    score: cosine(queryVector, vec),
  }))
  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, topK).map(s => items[s.index]!)
}

/** Simple cosine similarity (inline to avoid cross-package dependency). */
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d === 0 ? 0 : dot / d
}

/** Flatten a JSON item to natural language text for embedding. */
function flattenItemForEmbedding(item: unknown): string {
  if (item === null || item === undefined) return ''
  if (typeof item !== 'object') return String(item)
  if (Array.isArray(item)) return item.map(flattenItemForEmbedding).join(' ')

  const obj = item as Record<string, unknown>
  const parts: Array<{ key: string; value: string; len: number }> = []

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      if (/^https?:\/\//.test(value) || value.startsWith('data:')) continue
      parts.push({ key, value, len: value.length })
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      const s = String(value)
      parts.push({ key, value: s, len: s.length })
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      const joined = value.slice(0, 5).join(', ')
      parts.push({ key, value: joined, len: joined.length })
    }
  }

  parts.sort((a, b) => b.len - a.len)

  let text = ''
  for (const p of parts) {
    const seg = `${p.key}: ${p.value}`
    if (text.length + seg.length + 2 > 2000) break
    if (text) text += '. '
    text += seg
  }
  return text
}

/**
 * LLM-guided strategy: use an extra LLM call to merge multiple results or focus a single result.
 * LLM infrastructure errors (network, auth, rate limit) propagate to the caller.
 * Falls back to array strategy if the LLM returns invalid JSON.
 */
async function mergeLlmGuided(
  toolResults: ToolResultEntry[],
  userMessage: string,
  llm: LLMTextFn,
  embedFn?: (texts: string[]) => Promise<number[][]>,
  embedTopK?: number,
): Promise<StructuredResponse> {
  const prompt = toolResults.length === 1 ? FOCUS_PROMPT : MERGE_PROMPT

  // If embedding is available, reduce large arrays to the most relevant items
  const reducedResults = embedFn
    ? await reduceWithEmbeddings(toolResults, userMessage, embedFn, embedTopK ?? 8)
    : toolResults

  const resultsText = reducedResults
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
  embedFn?: EmbedFn,
  embedTopK?: number,
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
  embedFn?: EmbedFn,
  embedTopK?: number,
): Promise<StructuredResponse>
export async function formatStructuredResponse(
  toolResults: ToolResultEntry[],
  strategy: MergeStrategy = MergeStrategy.LlmGuided,
  userMessage?: string,
  llm?: LLMTextFn,
  embedFn?: EmbedFn,
  embedTopK?: number,
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
        return mergeLlmGuided(toolResults, userMessage, llm, embedFn, embedTopK)
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
