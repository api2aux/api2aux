/**
 * @api2aux/embedding-service
 *
 * Types for the embedding service.
 */

/** An embedding provider that can convert text to vectors. */
export interface EmbeddingProvider {
  /** Unique provider identifier. */
  readonly id: string
  /** Display name for UI. */
  readonly name: string
  /** Dimensionality of the vectors this provider produces (e.g., 384 for gte-small, 1536 for text-embedding-3-small). */
  readonly dimensions: number
  /** Convert an array of texts into embedding vectors. */
  embed(texts: string[]): Promise<number[][]>
  /** Whether the provider is ready to embed (model loaded, API key set, etc.). */
  isReady(): boolean
}

/** Configuration for the embedding service. */
export type EmbeddingServiceConfig =
  | { provider: 'local'; localModel?: string; topK?: number }
  | { provider: 'openai'; openaiApiKey: string; openaiModel?: string; topK?: number }

/** A single result entry from a relevance search. */
export interface RelevanceEntry {
  /** Index of the item in the original array. */
  readonly index: number
  /** Cosine similarity score in [-1, 1]. */
  readonly score: number
}

/** Result of a relevance search — entries ordered by score (highest first). */
export interface RelevanceResult {
  /** Top-K results ordered by relevance (highest score first). */
  results: readonly RelevanceEntry[]
}
