/**
 * Default constants for the chat engine.
 */

/** Maximum tool-calling rounds before forcing a text response. */
export const MAX_ROUNDS = 3

/** Maximum characters of tool result to feed back to the LLM. */
export const TRUNCATION_LIMIT = 8000

/** Run merge/focus LLM call in parallel with text response streaming. */
export const PARALLEL_MERGE = true

/** Message shown when the LLM responds without any successful tool calls (no-knowledge guardrail). */
export const NO_DATA_MESSAGE =
  "I couldn't find the right API endpoint to answer your question. " +
  'Try rephrasing, or check if the API has the data you\'re looking for.'
