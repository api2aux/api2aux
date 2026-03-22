/**
 * EmbeddingService — provider-agnostic embedding and semantic search.
 *
 * Wraps embedding providers (local or API) and provides high-level
 * semantic operations: embed, similarity, findRelevant.
 */

import type { EmbeddingProvider, EmbeddingServiceConfig, RelevanceResult } from './types'
import { flattenForEmbedding } from './flatten'
import { cosineSimilarity, topK } from './similarity'
import { LocalEmbeddingProvider } from './providers/local'
import { OpenAIEmbeddingProvider } from './providers/openai'

const DEFAULT_TOP_K = 8
const MAX_CACHE_SIZE = 2000

export class EmbeddingService {
  private provider: EmbeddingProvider
  private localProvider: LocalEmbeddingProvider | null = null
  private openaiProvider: OpenAIEmbeddingProvider | null = null
  private topKValue: number
  private vectorCache = new Map<string, number[]>()

  constructor(config: EmbeddingServiceConfig) {
    this.topKValue = config.topK ?? DEFAULT_TOP_K

    if (config.provider === 'openai') {
      if (!config.openaiApiKey) {
        console.warn('[embedding-service] OpenAI provider requested but API key is empty — embedding calls will fail until a key is provided via setProvider()')
      }
      this.openaiProvider = new OpenAIEmbeddingProvider(config.openaiApiKey, config.openaiModel)
      this.provider = this.openaiProvider
    } else {
      this.localProvider = new LocalEmbeddingProvider(config.localModel)
      this.provider = this.localProvider
    }
  }

  /** Get the current provider ID. */
  getProviderId(): string {
    return this.provider.id
  }

  /** Whether the current provider is ready. */
  isReady(): boolean {
    return this.provider.isReady()
  }

  /** Switch to a different provider. Clears the vector cache to prevent cross-dimensionality corruption. */
  setProvider(providerId: 'local' | 'openai', config?: { apiKey?: string; model?: string }): void {
    const previousId = this.provider.id
    if (providerId === 'openai') {
      if (!this.openaiProvider) {
        this.openaiProvider = new OpenAIEmbeddingProvider(config?.apiKey ?? '', config?.model)
      } else if (config?.apiKey) {
        this.openaiProvider.setApiKey(config.apiKey)
      }
      this.provider = this.openaiProvider
    } else {
      if (!this.localProvider) {
        this.localProvider = new LocalEmbeddingProvider(config?.model)
      }
      this.provider = this.localProvider
    }
    // Clear cache when switching providers to avoid mixing different-dimensionality vectors
    if (previousId !== this.provider.id) {
      this.vectorCache.clear()
    }
  }

  /** Embed an array of texts into vectors. Uses cached vectors when available. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const results: (number[] | undefined)[] = new Array(texts.length)
    const uncachedIndices: number[] = []
    const uncachedTexts: string[] = []

    for (let i = 0; i < texts.length; i++) {
      const cached = this.vectorCache.get(texts[i]!)
      if (cached) {
        results[i] = cached
      } else {
        uncachedIndices.push(i)
        uncachedTexts.push(texts[i]!)
      }
    }

    if (uncachedTexts.length > 0) {
      let newVectors: number[][]
      try {
        newVectors = await this.provider.embed(uncachedTexts)
      } catch (err) {
        const providerName = this.provider.id
        const original = err instanceof Error ? err.message : String(err)
        throw new Error(`Embedding provider "${providerName}" failed: ${original}`)
      }

      if (newVectors.length !== uncachedTexts.length) {
        throw new Error(
          `Embedding provider "${this.provider.id}" returned ${newVectors.length} vectors ` +
          `for ${uncachedTexts.length} input texts — results would be corrupted`
        )
      }

      // Spot-check: verify the first vector matches the declared dimensionality
      if (newVectors.length > 0 && newVectors[0]!.length !== this.provider.dimensions) {
        throw new Error(
          `Embedding provider "${this.provider.id}" returned vectors of dimension ${newVectors[0]!.length} ` +
          `but declared dimensions=${this.provider.dimensions} — similarity scores would be meaningless`
        )
      }

      for (let j = 0; j < uncachedIndices.length; j++) {
        const idx = uncachedIndices[j]!
        results[idx] = newVectors[j]!
        // FIFO eviction: remove oldest entry when cache is full
        if (this.vectorCache.size >= MAX_CACHE_SIZE) {
          const firstKey = this.vectorCache.keys().next().value as string
          this.vectorCache.delete(firstKey)
        }
        this.vectorCache.set(texts[idx]!, newVectors[j]!)
      }
    }

    return results as number[][]
  }

  /** Compute cosine similarity between two vectors. */
  similarity(a: number[], b: number[]): number {
    return cosineSimilarity(a, b)
  }

  /**
   * Find the most relevant items from a data array for a given query.
   *
   * 1. Flattens each item to natural language text
   * 2. Embeds query + items
   * 3. Returns top-K by cosine similarity
   */
  async findRelevant(query: string, items: unknown[], k?: number): Promise<RelevanceResult> {
    const effectiveK = k ?? this.topKValue
    if (items.length === 0) return { results: [] }
    if (items.length <= effectiveK) {
      return {
        results: items.map((_, i) => ({ index: i, score: 1.0 })),
      }
    }

    const itemTexts = items.map(flattenForEmbedding)
    const allTexts = [query, ...itemTexts]
    const allVectors = await this.embed(allTexts)

    const queryVector = allVectors[0]!
    const itemVectors = allVectors.slice(1)

    return topK(queryVector, itemVectors, effectiveK)
  }

  /**
   * Reduce a data array to only the most relevant items for a query.
   * Convenience method that returns the actual items, not just indices.
   */
  async reduceToRelevant<T>(query: string, items: T[], k?: number): Promise<T[]> {
    const { results } = await this.findRelevant(query, items, k)
    return results.map(r => items[r.index]!)
  }

  /** Clear the embedding vector cache. */
  clearCache(): void {
    this.vectorCache.clear()
  }

  /** Clean up resources (terminate workers, etc.). */
  destroy(): void {
    this.vectorCache.clear()
    this.localProvider?.destroy()
  }
}
