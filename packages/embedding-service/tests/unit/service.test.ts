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
    embed: embedMock,
    isReady: () => true,
    embedMock,
  }
}

describe('EmbeddingService', () => {
  it('embeds texts via the configured provider', async () => {
    // Use OpenAI provider path with a mock
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

  it('findRelevant returns top-K indices and scores', async () => {
    const service = new EmbeddingService({ provider: 'local', topK: 2 })

    // Mock provider that returns vectors where similarity to query varies
    const mockProvider: EmbeddingProvider = {
      id: 'mock',
      name: 'Mock',
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
    expect(result.indices).toHaveLength(2)
    expect(result.scores).toHaveLength(2)
    // Beauty item should rank highest
    expect(result.indices[0]).toBe(1) // beauty
    expect(result.indices[1]).toBe(2) // fragrance
  })

  it('findRelevant returns all items when K >= items.length', async () => {
    const service = new EmbeddingService({ provider: 'local', topK: 10 })
    const mockProvider = createMockProvider('test')
    ;(service as unknown as { provider: EmbeddingProvider }).provider = mockProvider

    const items = [{ a: 1 }, { b: 2 }]
    const result = await service.findRelevant('query', items)

    // When items <= topK, return all with score 1.0 (no embedding needed)
    expect(result.indices).toEqual([0, 1])
    expect(result.scores).toEqual([1.0, 1.0])
    expect(mockProvider.embedMock).not.toHaveBeenCalled()
  })

  it('findRelevant handles empty items', async () => {
    const service = new EmbeddingService({ provider: 'local' })
    const result = await service.findRelevant('query', [])
    expect(result.indices).toEqual([])
    expect(result.scores).toEqual([])
  })

  it('reduceToRelevant returns actual items', async () => {
    const service = new EmbeddingService({ provider: 'local', topK: 1 })

    const mockProvider: EmbeddingProvider = {
      id: 'mock',
      name: 'Mock',
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
})
