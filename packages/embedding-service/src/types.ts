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
  /** Convert an array of texts into embedding vectors. */
  embed(texts: string[]): Promise<number[][]>
  /** Whether the provider is ready to embed (model loaded, API key set, etc.). */
  isReady(): boolean
}

/** Configuration for the embedding service. */
export interface EmbeddingServiceConfig {
  /** Default provider to use. */
  provider: 'local' | 'openai'
  /** Model ID for the local provider (default: 'Xenova/gte-small'). */
  localModel?: string
  /** OpenAI API key (reuses chat key if not set). */
  openaiApiKey?: string
  /** OpenAI model (default: 'text-embedding-3-small'). */
  openaiModel?: string
  /** Number of top results to return from findRelevant (default: 8). */
  topK?: number
}

/** Result of a relevance search. */
export interface RelevanceResult {
  /** Indices of the top-K most relevant items in the original array. */
  indices: number[]
  /** Cosine similarity scores for each selected item (same order as indices). */
  scores: number[]
}
