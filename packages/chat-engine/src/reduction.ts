/**
 * Focus reduction strategies.
 *
 * Reduces per-item data SIZE before sending to the focus/merge LLM,
 * while preserving ALL items in the array (item-level filtering, if any,
 * happens earlier via the embedding service). Three strategies:
 *
 * - truncate-values: keep all fields, truncate long values (default)
 * - embed-fields: select relevant fields via embedding similarity
 * - llm-fields: select relevant fields via lightweight LLM call
 */

import type { ToolResultEntry, LLMTextFn, EmbedFn, ChatMessage } from './types'
import { MessageRole, FocusReduction } from './types'
import { extractJson } from './response'

// ── Public API ──

/** Options for focus reduction strategies. */
export interface ReductionOptions {
  strategy: FocusReduction
  embedFn?: EmbedFn
  llmText?: LLMTextFn
  onWarning?: (message: string) => void
  domainFields?: ReadonlySet<string>
}

/**
 * Reduce each tool result's data for the focus/merge LLM.
 * Preserves all items; reduces per-item size via the chosen strategy.
 */
export async function reduceToolResultsForFocus(
  toolResults: ToolResultEntry[],
  query: string,
  options: ReductionOptions,
): Promise<ToolResultEntry[]> {
  const { strategy, embedFn, llmText, onWarning, domainFields } = options
  const reduced: ToolResultEntry[] = []

  for (const result of toolResults) {
    let reducedData: unknown
    try {
      reducedData = await reduceData(result.data, query, strategy, embedFn, llmText, onWarning, domainFields)
    } catch (err) {
      // Distinguish programming errors from expected failures
      const msg = err instanceof Error ? err.message : String(err)
      if (err instanceof TypeError || err instanceof ReferenceError) {
        console.error('[chat-engine] Focus reduction hit unexpected error (possible bug):', err)
      } else {
        console.warn('[chat-engine] Focus reduction failed, using raw data:', msg)
      }
      onWarning?.(`Focus reduction (${strategy}) failed, showing raw data: ${msg}`)
      reducedData = result.data
    }
    reduced.push(reducedData !== result.data ? { ...result, data: reducedData } : result)
  }

  return reduced
}

/** Route to the correct strategy for a data value. */
async function reduceData(
  data: unknown,
  query: string,
  strategy: FocusReduction,
  embedFn?: EmbedFn,
  llmText?: LLMTextFn,
  onWarning?: (message: string) => void,
  domainFields?: ReadonlySet<string>,
): Promise<unknown> {
  switch (strategy) {
    case FocusReduction.TruncateValues:
      return truncateValues(data, domainFields)

    case FocusReduction.EmbedFields:
      if (embedFn) return embedFieldSelection(data, query, embedFn)
      throw new Error('embed-fields strategy requested but embedFn not provided — check ChatEngineConfig')

    case FocusReduction.LlmFields:
      if (llmText) return llmFieldSelection(data, query, llmText, onWarning, domainFields)
      throw new Error('llm-fields strategy requested but llmText not provided — check ChatEngineConfig')

    default:
      return truncateValues(data, domainFields)
  }
}

// ── truncate-values strategy ──

const MAX_STRING_LENGTH = 200
const MAX_ARRAY_ITEMS = 5

/** Keep all fields, truncate long values. Domain-important fields are preserved at full length. */
export function truncateValues(data: unknown, domainFields?: ReadonlySet<string>): unknown {
  return truncateValuesInternal(data, 0, false, domainFields)
}

function truncateValuesInternal(data: unknown, depth: number, insideArrayItem: boolean, domainFields?: ReadonlySet<string>): unknown {
  if (data === null || data === undefined) return data
  if (typeof data !== 'object') return truncateScalar(data)

  if (Array.isArray(data)) {
    // Top-level arrays: preserve all items, truncate each
    return data.map(item => truncateValuesInternal(item, depth + 1, true, domainFields))
  }

  const obj = data as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = value
      continue
    }

    const isDomainField = domainFields !== undefined && domainFields.has(key.toLowerCase())

    if (typeof value === 'string') {
      if (!isDomainField && value.length > MAX_STRING_LENGTH && !looksLikeUrl(value)) {
        result[key] = value.slice(0, MAX_STRING_LENGTH) + '...'
      } else {
        result[key] = value
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    } else if (Array.isArray(value)) {
      result[key] = truncateArray(key, value, depth, insideArrayItem, domainFields)
    } else if (typeof value === 'object') {
      result[key] = truncateValuesInternal(value, depth + 1, insideArrayItem, domainFields)
    }
  }

  return result
}

function truncateScalar(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
    return value.slice(0, MAX_STRING_LENGTH) + '...'
  }
  return value
}

function truncateArray(key: string, arr: unknown[], depth: number, insideArrayItem: boolean, domainFields?: ReadonlySet<string>): unknown {
  if (arr.length === 0) return arr

  // Array of objects: preserve when it's a primary data array (top-level or inside
  // an envelope object like { result: { providers: [...] } }). Summarize when it's
  // a nested detail array inside an array item (like recipe.reviews).
  if (typeof arr[0] === 'object' && arr[0] !== null && !Array.isArray(arr[0])) {
    if (!insideArrayItem) {
      // Primary data array — preserve every item, truncate each item's values
      return arr.map(item => truncateValuesInternal(item, depth + 1, true, domainFields))
    }
    return summarizeObjectArray(key, arr)
  }

  // Array of strings → keep first N
  if (typeof arr[0] === 'string') {
    if (arr.length <= MAX_ARRAY_ITEMS) return arr
    return [...arr.slice(0, MAX_ARRAY_ITEMS), `...and ${arr.length - MAX_ARRAY_ITEMS} more`]
  }

  // Other arrays → keep first N
  if (arr.length <= MAX_ARRAY_ITEMS) return arr
  return [...arr.slice(0, MAX_ARRAY_ITEMS), `...and ${arr.length - MAX_ARRAY_ITEMS} more`]
}

function summarizeObjectArray(key: string, arr: unknown[]): string {
  // Find a numeric field for averaging (like rating)
  const firstItem = arr[0] as Record<string, unknown>
  for (const [fieldName, fieldValue] of Object.entries(firstItem)) {
    if (typeof fieldValue === 'number' && !fieldName.toLowerCase().includes('id')) {
      const values = arr
        .map(item => (item as Record<string, unknown>)[fieldName])
        .filter((v): v is number => typeof v === 'number')
      if (values.length > 0) {
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length
        return `${arr.length} ${key}, avg ${fieldName} ${avg.toFixed(1)}`
      }
    }
  }
  return `${arr.length} ${key}`
}

// ── embed-fields strategy ──

const ALWAYS_INCLUDE_FIELDS = new Set(['id', '_id', 'name', 'title', 'label'])
const DEFAULT_FIELD_K = 10

/**
 * Select relevant fields via embedding similarity.
 * Builds field descriptors from sample values, embeds them alongside the query,
 * selects top-K fields, returns all items with only those fields.
 */
export async function embedFieldSelection(
  data: unknown,
  query: string,
  embedFn: EmbedFn,
): Promise<unknown> {
  const { items, wrapper, arrayKey } = extractItems(data)
  if (!items || items.length === 0) return data

  // Build field descriptors: "fieldName: sampleValue1, sampleValue2, ..."
  const fieldNames = collectFieldNames(items)
  if (fieldNames.length === 0) return data

  const descriptors = fieldNames.map(name => buildFieldDescriptor(name, items))

  // Embed query + descriptors
  const allTexts = [query, ...descriptors]
  const allVectors = await embedFn(allTexts)

  if (allVectors.length !== allTexts.length) {
    throw new Error(`embedFn returned ${allVectors.length} vectors for ${allTexts.length} inputs`)
  }

  // Length validated above — index 0 is guaranteed to exist
  const queryVector = allVectors[0]!
  const fieldVectors = allVectors.slice(1)

  // Score fields by cosine similarity
  const scored = fieldVectors.map((vec, i) => ({
    name: fieldNames[i]!,
    score: cosine(queryVector, vec),
  }))
  scored.sort((a, b) => b.score - a.score)

  // Select top-K embedding-ranked fields, then add identity fields on top (additive)
  const selectedFields = new Set<string>()
  for (const { name } of scored) {
    if (selectedFields.size >= DEFAULT_FIELD_K) break
    selectedFields.add(name)
  }
  for (const field of ALWAYS_INCLUDE_FIELDS) {
    if (fieldNames.includes(field)) selectedFields.add(field)
  }

  // Filter items to selected fields only
  const filteredItems = items.map(item => filterFields(item, selectedFields))
  return wrapper && arrayKey ? { ...wrapper, [arrayKey]: filteredItems } : filteredItems
}

// ── llm-fields strategy ──

const FIELD_SELECTION_PROMPT = `You are a data analyst. Given a user's question and the available data fields (with a sample row), determine which fields are needed to answer the question. Return ONLY a JSON array of field names, nothing else.`

/**
 * Select relevant fields via a lightweight LLM call.
 * Sends field names + one sample row to the LLM, gets back a list of relevant fields.
 */
export async function llmFieldSelection(
  data: unknown,
  query: string,
  llmText: LLMTextFn,
  onWarning?: (message: string) => void,
  domainFields?: ReadonlySet<string>,
): Promise<unknown> {
  const { items, wrapper, arrayKey } = extractItems(data)
  if (!items || items.length === 0) return data

  const fieldNames = collectFieldNames(items)
  if (fieldNames.length === 0) return data

  // Build a compact sample: field names + first item (truncated)
  const sampleItem = truncateValues(items[0]) as Record<string, unknown>
  const sampleText = `Fields: ${fieldNames.join(', ')}\n\nSample item:\n${JSON.stringify(sampleItem, null, 2)}`

  const messages: ChatMessage[] = [
    { role: MessageRole.System, content: FIELD_SELECTION_PROMPT },
    { role: MessageRole.User, content: `Question: ${query}\n\n${sampleText}` },
  ]

  // LLM infrastructure errors (auth, rate limit, network) propagate to the caller —
  // the outer reduceToolResultsForFocus catch handles fallback to raw data.
  const content = await llmText(messages)

  const parsed = extractJson(content)
  if (!Array.isArray(parsed)) {
    const preview = content.length > 200 ? content.slice(0, 200) + '...' : content
    console.warn('[chat-engine] llm-fields returned non-array, falling back to truncate-values. LLM response:', preview)
    onWarning?.(`llm-fields: LLM did not return a field list (got ${parsed === null ? 'unparseable text' : typeof parsed}), falling back to truncate-values`)
    return truncateValues(data, domainFields)
  }

  // Validate LLM-selected field names against actual data fields
  const validFields = parsed.filter((f): f is string => typeof f === 'string' && fieldNames.includes(f))
  if (validFields.length === 0) {
    const preview = JSON.stringify(parsed).slice(0, 200)
    console.warn('[chat-engine] llm-fields: none of the LLM-selected fields exist in data. LLM returned:', preview)
    onWarning?.('llm-fields: LLM selected no valid fields, falling back to truncate-values')
    return truncateValues(data, domainFields)
  }

  // Build selected fields set, always include identity fields
  const selectedFields = new Set<string>(validFields)
  for (const field of ALWAYS_INCLUDE_FIELDS) {
    if (fieldNames.includes(field)) selectedFields.add(field)
  }

  const filteredItems = items.map(item => filterFields(item, selectedFields))
  return wrapper && arrayKey ? { ...wrapper, [arrayKey]: filteredItems } : filteredItems
}

// ── Shared utilities ──

/** Extract the main array of items from data (handles both direct arrays and wrapper objects). */
function extractItems(data: unknown): { items: Record<string, unknown>[] | null; wrapper: Record<string, unknown> | null; arrayKey: string | null } {
  if (Array.isArray(data)) {
    const objects = data.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item))
    return { items: objects.length > 0 ? objects : null, wrapper: null, arrayKey: null }
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    // Pick the largest array-of-objects property as the primary data array
    let bestKey: string | null = null
    let bestObjects: Record<string, unknown>[] | null = null
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        const objects = value.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item))
        if (objects.length > 0 && (bestObjects === null || objects.length > bestObjects.length)) {
          bestKey = key
          bestObjects = objects
        }
      }
    }
    if (bestKey && bestObjects) {
      return { items: bestObjects, wrapper: obj, arrayKey: bestKey }
    }
  }

  return { items: null, wrapper: null, arrayKey: null }
}

/** Collect all unique field names across items. */
function collectFieldNames(items: Record<string, unknown>[]): string[] {
  const fields = new Set<string>()
  for (const item of items) {
    for (const key of Object.keys(item)) {
      fields.add(key)
    }
  }
  return [...fields]
}

/** Build a field descriptor for embedding: "fieldName: sample1, sample2, ..." */
function buildFieldDescriptor(fieldName: string, items: Record<string, unknown>[]): string {
  const samples: string[] = []
  for (const item of items.slice(0, 5)) {
    const value = item[fieldName]
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      if (!looksLikeUrl(value)) {
        samples.push(value.length > 50 ? value.slice(0, 50) : value)
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      samples.push(String(value))
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      samples.push(value.slice(0, 3).join(', '))
    }
  }
  return `${fieldName}: ${samples.join(', ') || '(complex data)'}`
}

/** Filter an item to only include selected fields. */
function filterFields(item: Record<string, unknown>, fields: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (fields.has(key)) result[key] = value
  }
  return result
}

/** Cosine similarity between two vectors. */
function cosine(a: number[], b: number[]): number {
  if (a.length === 0) return 0
  if (a.length !== b.length) {
    console.warn(`[chat-engine] cosine: vector dimension mismatch (${a.length} vs ${b.length}), returning 0`)
    return 0
  }
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d === 0 ? 0 : dot / d
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//.test(s) || s.startsWith('data:')
}
