/**
 * @api2aux/embedding-service
 *
 * Reusable embedding service for semantic similarity search.
 * Runs in the browser (Transformers.js) or via API (OpenAI).
 *
 * Primary use case: reduce API response data by selecting only
 * semantically relevant items before sending to an LLM.
 *
 * Architecture:
 *   API response → flatten to text → embed → cosine similarity → top-K → LLM
 */

// === Types ===
export type { EmbeddingProvider, EmbeddingServiceConfig, RelevanceResult, RelevanceEntry } from './types'

// === Service ===
export { EmbeddingService } from './service'

// === Utilities ===
export { flattenForEmbedding, flattenItems } from './flatten'
export { cosineSimilarity, topK } from './similarity'

// === Providers ===
export { LocalEmbeddingProvider } from './providers/local'
export { OpenAIEmbeddingProvider } from './providers/openai'
