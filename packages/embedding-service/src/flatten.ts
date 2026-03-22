/**
 * JSON → text flattener for embedding.
 *
 * Converts arbitrary JSON objects into natural language text suitable for
 * embedding models. All scalar fields are included except URLs and base64
 * blobs (which carry no semantic value for embedding). Nested objects are
 * skipped; nested arrays are summarized. Fields are ordered by value
 * length (descending), so fields with longer values like title and
 * description appear first and survive the 2000-char truncation limit.
 * This approach is domain-agnostic and works for any API.
 *
 * Why flatten? Raw JSON wastes ~25% of tokens on structural syntax
 * ({, }, ", :, [, ]) that carries zero semantic value, reducing embedding
 * quality compared to natural language representations.
 */

/** Maximum characters per flattened item (gte-small supports 512 tokens ≈ ~2000 chars). */
const MAX_CHARS = 2000

/**
 * Flatten a JSON object into natural language text for embedding.
 *
 * Algorithm:
 * 1. Extract all scalar fields (string, number, boolean)
 * 2. For nested arrays: include summary (e.g., "reviews: 3 items")
 * 3. Sort: longer string values first (title/description bubble up)
 * 4. Format: "fieldName: value" pairs joined by ". "
 * 5. Cap at MAX_CHARS
 */
export function flattenForEmbedding(item: unknown): string {
  if (item === null || item === undefined) return ''
  if (typeof item !== 'object') return String(item)
  if (Array.isArray(item)) return flattenArray(item)

  const obj = item as Record<string, unknown>
  const parts: Array<{ key: string; value: string; length: number }> = []

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue

    if (typeof value === 'string') {
      if (looksLikeUrl(value) || looksLikeBase64(value)) continue
      parts.push({ key, value, length: value.length })
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      const str = String(value)
      parts.push({ key, value: str, length: str.length })
    } else if (Array.isArray(value)) {
      const summary = summarizeArray(key, value)
      if (summary) parts.push({ key, value: summary, length: summary.length })
    }
    // Skip nested objects — they add noise without clear semantic value
  }

  // Sort by string value length descending — longer strings (title, description) first
  parts.sort((a, b) => b.length - a.length)

  // Build natural language text
  let text = ''
  for (const part of parts) {
    const segment = `${part.key}: ${part.value}`
    if (text.length + segment.length + 2 > MAX_CHARS) break
    if (text) text += '. '
    text += segment
  }

  return text
}

/**
 * Flatten an array of items into individual texts for embedding.
 * Each item is flattened separately.
 */
export function flattenItems(items: unknown[]): string[] {
  return items.map(flattenForEmbedding)
}

/** Summarize an array field (e.g., reviews → "3 reviews"). */
function summarizeArray(key: string, arr: unknown[]): string | null {
  if (arr.length === 0) return null

  // Check if items have a numeric field (like rating) for average
  if (arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null) {
    const firstItem = arr[0] as Record<string, unknown>
    const numericField = Object.entries(firstItem).find(
      ([key, v]) => typeof v === 'number' && !['id', '_id'].includes(key),
    )
    if (numericField) {
      const values = arr
        .map(item => (item as Record<string, unknown>)[numericField[0]])
        .filter((v): v is number => typeof v === 'number')
      if (values.length > 0) {
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length
        return `${arr.length} ${key}, avg ${numericField[0]} ${avg.toFixed(1)}`
      }
    }
    return `${arr.length} ${key}`
  }

  // Primitive array — join first few values
  if (typeof arr[0] === 'string') {
    return arr.slice(0, 5).join(', ')
  }

  return `${arr.length} ${key}`
}

/** Flatten a top-level array by flattening each item. */
function flattenArray(arr: unknown[]): string {
  return arr.map(flattenForEmbedding).filter(Boolean).join('\n')
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//.test(s) || s.startsWith('data:')
}

function looksLikeBase64(s: string): boolean {
  return s.length > 100 && /^[A-Za-z0-9+/=]+$/.test(s)
}
