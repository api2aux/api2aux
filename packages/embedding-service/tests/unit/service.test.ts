import { describe, it, expect, vi } from 'vitest'
import { EmbeddingService } from '../../src/service'
import type { EmbeddingProvider } from '../../src/types'

/** Mock provider that returns predictable vectors based on text content. */
function createMockProvider(id: string): EmbeddingProvider & { embedMock: ReturnType<typeof vi.fn> } {
  const embedMock = vi.fn().mockImplementation(async (texts: string[]) => {
    // Generate deterministic vectors based on text length and first char
    return texts.map(text => {
      const len = text.length
      const code = text.charCodeAt(0) || 0
      return [len / 100, code / 200, (len + code) / 300]
    })
  })

  return {
    id,
    name: `Mock ${id}`,
    dimensions: 3,
    embed: embedMock,
    isReady: () => true,
    embedMock,
  }
}

describe('EmbeddingService', () => {
  it('embeds texts via the configured provider', async () => {
    const service = new EmbeddingService({
      provider: 'local',
      localModel: 'test-model',
    })

    // Replace the internal provider with our mock
    const mockProvider = createMockProvider('test')
    ;(service as unknown as { provider: EmbeddingProvider }).provider = mockProvider

    const vectors = await service.embed(['hello', 'world'])
    expect(vectors).toHaveLength(2)
    expect(mockProvider.embedMock).toHaveBeenCalledWith(['hello', 'world'])
  })

  it('findRelevant returns top-K results', async () => {
    const service = new EmbeddingService({ provider: 'local', topK: 2 })

    // Mock provider that returns vectors where similarity to query varies
    const mockProvider: EmbeddingProvider = {
      id: 'mock',
      name: 'Mock',
      dimensions: 3,
      isReady: () => true,
      embed: async (texts: string[]) => {
        // First text is the query, rest are items
        return texts.map((text, i) => {
          if (i === 0) return [1, 0, 0] // query vector
          // Items with different similarities
          if (text.includes('beauty')) return [0.9, 0.1, 0]   // high similarity
          if (text.includes('fragrance')) return [0.8, 0.2, 0] // medium similarity
          return [0, 1, 0] // low similarity
        })
      },
    }
    ;(service as unknown as { provider: EmbeddingProvider }).provider = mockProvider

    const items = [
      { title: 'Sofa', category: 'furniture' },
      { title: 'Lipstick', category: 'beauty' },
      { title: 'Perfume', category: 'fragrance' },
    ]

    const result = await service.findRelevant('gift for wife', items, 2)
    expect(result.results).toHaveLength(2)
    // Beauty item should rank highest
    expect(result.results[0]!.index).toBe(1) // beauty
    expect(result.results[1]!.index).toBe(2) // fragrance
  })

  it('findRelevant returns all items when K >= items.length', async () => {
    const service = new EmbeddingService({ provider: 'local', topK: 10 })
    const mockProvider = createMockProvider('test')
    ;(service as unknown as { provider: EmbeddingProvider }).provider = mockProvider

    const items = [{ a: 1 }, { b: 2 }]
    const result = await service.findRelevant('query', items)

    // When items <= topK, return all with score 1.0 (no embedding needed)
    expect(result.results).toEqual([
      { index: 0, score: 1.0 },
      { index: 1, score: 1.0 },
    ])
    expect(mockProvider.embedMock).not.toHaveBeenCalled()
  })

  it('findRelevant handles empty items', async () => {
    const service = new EmbeddingService({ provider: 'local' })
    const result = await service.findRelevant('query', [])
    expect(result.results).toEqual([])
  })

  it('reduceToRelevant returns actual items', async () => {
    const service = new EmbeddingService({ provider: 'local', topK: 1 })

    const mockProvider: EmbeddingProvider = {
      id: 'mock',
      name: 'Mock',
      dimensions: 2,
      isReady: () => true,
      embed: async (texts: string[]) => {
        return texts.map((_, i) => {
          if (i === 0) return [1, 0] // query
          if (i === 2) return [0.9, 0.1] // second item — most similar
          return [0, 1] // others
        })
      },
    }
    ;(service as unknown as { provider: EmbeddingProvider }).provider = mockProvider

    const items = [
      { title: 'A' },
      { title: 'B' },
      { title: 'C' },
    ]

    const result = await service.reduceToRelevant('query', items, 1)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ title: 'B' })
  })

  it('reports provider readiness', () => {
    const service = new EmbeddingService({ provider: 'local' })
    // Local provider starts not ready (model not loaded)
    // In tests without browser Worker, it loads on first embed call
    expect(typeof service.isReady()).toBe('boolean')
  })

  it('returns correct provider ID', () => {
    const service = new EmbeddingService({ provider: 'local' })
    expect(service.getProviderId()).toBe('local')
  })

  // ── Caching tests ──

  it('caches vectors — second call skips provider', async () => {
    const service = new EmbeddingService({ provider: 'local' })
    const mockProvider = createMockProvider('test')
    ;(service as unknown as { provider: EmbeddingProvider }).provider = mockProvider

    await service.embed(['hello', 'world'])
    expect(mockProvider.embedMock).toHaveBeenCalledTimes(1)

    // Second call with same texts should hit cache
    await service.embed(['hello', 'world'])
    expect(mockProvider.embedMock).toHaveBeenCalledTimes(1) // NOT called again
  })

  it('handles partial cache hits correctly', async () => {
    const service = new EmbeddingService({ provider: 'local' })
    const mockProvider = createMockProvider('test')
    ;(service as unknown as { provider: EmbeddingProvider }).provider = mockProvider

    // First call caches 'hello'
    await service.embed(['hello'])
    expect(mockProvider.embedMock).toHaveBeenCalledTimes(1)

    // Second call: 'hello' is cached, 'world' is not
    const result = await service.embed(['hello', 'world'])
    expect(mockProvider.embedMock).toHaveBeenCalledTimes(2)
    expect(mockProvider.embedMock).toHaveBeenLastCalledWith(['world']) // Only uncached text
    expect(result).toHaveLength(2) // Both results present
  })

  it('clearCache invalidates cached vectors', async () => {
    const service = new EmbeddingService({ provider: 'local' })
    const mockProvider = createMockProvider('test')
    ;(service as unknown as { provider: EmbeddingProvider }).provider = mockProvider

    await service.embed(['hello'])
    service.clearCache()
    await service.embed(['hello'])
    expect(mockProvider.embedMock).toHaveBeenCalledTimes(2) // Called again after clear
  })

  // ── setProvider tests ──

  it('setProvider switches to a different provider and clears cache', async () => {
    const service = new EmbeddingService({ provider: 'local' })
    const localMock = createMockProvider('local')
    ;(service as unknown as { provider: EmbeddingProvider }).provider = localMock
    ;(service as unknown as { localProvider: EmbeddingProvider }).localProvider = localMock

    // Embed something to populate cache
    await service.embed(['hello'])
    expect(localMock.embedMock).toHaveBeenCalledTimes(1)

    // Switch to OpenAI
    service.setProvider('openai', { apiKey: 'test-key' })
    expect(service.getProviderId()).toBe('openai')

    // Switch back to local
    service.setProvider('local')
    expect(service.getProviderId()).toBe('local')
  })

  // ── Error handling tests ──

  it('wraps provider errors with context', async () => {
    const service = new EmbeddingService({ provider: 'local' })
    const failingProvider: EmbeddingProvider = {
      id: 'failing',
      name: 'Failing',
      dimensions: 3,
      isReady: () => true,
      embed: async () => { throw new Error('WASM OOM') },
    }
    ;(service as unknown as { provider: EmbeddingProvider }).provider = failingProvider

    await expect(service.embed(['test'])).rejects.toThrow('Embedding provider "failing" failed: WASM OOM')
  })

  it('throws when provider returns wrong number of vectors', async () => {
    const service = new EmbeddingService({ provider: 'local' })
    const badProvider: EmbeddingProvider = {
      id: 'bad',
      name: 'Bad',
      dimensions: 3,
      isReady: () => true,
      embed: async () => [[1, 2, 3]], // Returns 1 vector for 2 inputs
    }
    ;(service as unknown as { provider: EmbeddingProvider }).provider = badProvider

    await expect(service.embed(['a', 'b'])).rejects.toThrow('returned 1 vectors for 2 input texts')
  })
})
