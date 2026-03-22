import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenAIEmbeddingProvider } from '../../src/providers/openai'

// Mock global fetch
const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OpenAIEmbeddingProvider', () => {
  it('returns embeddings sorted by index', async () => {
    const provider = new OpenAIEmbeddingProvider('test-key')

    // API returns results out of order
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: [0.2, 0.3] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    })

    const result = await provider.embed(['text1', 'text2'])
    expect(result).toEqual([[0.1, 0.2], [0.2, 0.3]])
  })

  it('throws on empty API key', async () => {
    const provider = new OpenAIEmbeddingProvider('')
    await expect(provider.embed(['test'])).rejects.toThrow('API key not configured')
  })

  it('throws descriptive error on HTTP failure', async () => {
    const provider = new OpenAIEmbeddingProvider('test-key')

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    })

    await expect(provider.embed(['test'])).rejects.toThrow('OpenAI embedding failed (401): Unauthorized')
  })

  it('throws on malformed JSON response', async () => {
    const provider = new OpenAIEmbeddingProvider('test-key')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token') },
    })

    await expect(provider.embed(['test'])).rejects.toThrow('invalid JSON')
  })

  it('throws on unexpected response shape', async () => {
    const provider = new OpenAIEmbeddingProvider('test-key')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ unexpected: 'shape' }),
    })

    await expect(provider.embed(['test'])).rejects.toThrow('unexpected response shape')
  })

  it('returns empty array for empty input', async () => {
    const provider = new OpenAIEmbeddingProvider('test-key')
    const result = await provider.embed([])
    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('retries on 429 rate limit', async () => {
    const provider = new OpenAIEmbeddingProvider('test-key')

    // First call: 429
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    })

    // Second call: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: [0.1] }],
      }),
    })

    const result = await provider.embed(['test'])
    expect(result).toEqual([[0.1]])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('retries on 500 server error', async () => {
    const provider = new OpenAIEmbeddingProvider('test-key')

    // First call: 500
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    })

    // Second call: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: [0.1] }],
      }),
    })

    const result = await provider.embed(['test'])
    expect(result).toEqual([[0.1]])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('does not retry on 401 auth failure', async () => {
    const provider = new OpenAIEmbeddingProvider('bad-key')

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    })

    await expect(provider.embed(['test'])).rejects.toThrow('(401)')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('isReady reflects API key state', () => {
    const provider = new OpenAIEmbeddingProvider('')
    expect(provider.isReady()).toBe(false)

    provider.setApiKey('sk-test')
    expect(provider.isReady()).toBe(true)
  })

  it('has correct dimensions for default model', () => {
    const provider = new OpenAIEmbeddingProvider('test-key')
    expect(provider.dimensions).toBe(1536)
  })

  it('has correct dimensions for text-embedding-3-large', () => {
    const provider = new OpenAIEmbeddingProvider('test-key', 'text-embedding-3-large')
    expect(provider.dimensions).toBe(3072)
  })

  it('falls back to 1536 for unknown models', () => {
    const provider = new OpenAIEmbeddingProvider('test-key', 'custom-finetune')
    expect(provider.dimensions).toBe(1536)
  })

  it('passes correct model in request body', async () => {
    const provider = new OpenAIEmbeddingProvider('test-key', 'custom-model')

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding: [0.1] }],
      }),
    })

    await provider.embed(['test'])

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.model).toBe('custom-model')
    expect(body.input).toEqual(['test'])
  })
})
