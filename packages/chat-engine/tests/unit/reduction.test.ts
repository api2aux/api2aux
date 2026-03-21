import { describe, it, expect, vi } from 'vitest'
import { truncateValues, reduceToolResultsForFocus } from '../../src/reduction'
import type { ToolResultEntry, LLMTextFn } from '../../src/types'

// ── truncate-values strategy ──

describe('truncateValues', () => {
  it('preserves all items in a top-level array', () => {
    const data = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]
    const result = truncateValues(data) as typeof data
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ id: 1, name: 'A' })
  })

  it('preserves all items in a wrapper object array', () => {
    const data = {
      products: [
        { id: 1, title: 'Product A' },
        { id: 2, title: 'Product B' },
      ],
      total: 2,
    }
    const result = truncateValues(data) as typeof data
    expect(result.products).toHaveLength(2)
    expect(result.products[0]).toEqual({ id: 1, title: 'Product A' })
    expect(result.total).toBe(2)
  })

  it('truncates long string values at 200 chars', () => {
    const longStr = 'x'.repeat(300)
    const data = { description: longStr }
    const result = truncateValues(data) as Record<string, string>
    expect(result.description).toHaveLength(203) // 200 + "..."
    expect(result.description.endsWith('...')).toBe(true)
  })

  it('replaces URLs with [url] placeholder', () => {
    const data = {
      image: 'https://cdn.example.com/image.webp',
      thumbnail: 'https://cdn.example.com/thumb.webp',
      name: 'keep this',
    }
    const result = truncateValues(data) as Record<string, string>
    expect(result.image).toBe('[url]')
    expect(result.thumbnail).toBe('[url]')
    expect(result.name).toBe('keep this')
  })

  it('summarizes nested object arrays (like reviews)', () => {
    const data = {
      recipes: [
        {
          id: 1,
          name: 'Recipe',
          reviews: [
            { rating: 5, comment: 'Great!' },
            { rating: 3, comment: 'OK' },
          ],
        },
      ],
    }
    const result = truncateValues(data) as { recipes: Array<{ reviews: string }> }
    expect(result.recipes).toHaveLength(1)
    expect(result.recipes[0]!.reviews).toBe('2 reviews, avg rating 4.0')
  })

  it('truncates string arrays longer than 5 items', () => {
    const data = {
      items: [
        {
          tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        },
      ],
    }
    const result = truncateValues(data) as { items: Array<{ tags: string[] }> }
    expect(result.items[0]!.tags).toHaveLength(6) // 5 + "...and 2 more"
    expect(result.items[0]!.tags[5]).toBe('...and 2 more')
  })

  it('keeps short string arrays intact', () => {
    const data = {
      items: [{ tags: ['a', 'b', 'c'] }],
    }
    const result = truncateValues(data) as { items: Array<{ tags: string[] }> }
    expect(result.items[0]!.tags).toEqual(['a', 'b', 'c'])
  })

  it('preserves scalars (numbers, booleans)', () => {
    const data = { price: 9.99, inStock: true, rating: 4.5 }
    const result = truncateValues(data)
    expect(result).toEqual(data)
  })

  it('handles null and undefined values', () => {
    const data = { a: null, b: undefined, c: 'keep' }
    const result = truncateValues(data) as Record<string, unknown>
    expect(result.a).toBeNull()
    expect(result.b).toBeUndefined()
    expect(result.c).toBe('keep')
  })

  it('handles data:URIs as URLs', () => {
    const data = { qrCode: 'data:image/png;base64,abc123' }
    const result = truncateValues(data) as Record<string, string>
    expect(result.qrCode).toBe('[url]')
  })

  it('handles empty data', () => {
    expect(truncateValues(null)).toBeNull()
    expect(truncateValues(undefined)).toBeUndefined()
    expect(truncateValues(42)).toBe(42)
    expect(truncateValues('hello')).toBe('hello')
  })

  it('does not collapse top-level wrapper object arrays into summaries', () => {
    const data = {
      recipes: [
        { id: 1, name: 'Chickpea Tagine', rating: 4.5 },
        { id: 2, name: 'Falafel Wrap', rating: 4.7 },
        { id: 3, name: 'Stir Fry', rating: 4.0 },
      ],
      total: 3,
    }
    const result = truncateValues(data) as typeof data
    // Must preserve all items, not summarize to "3 recipes, avg rating 4.4"
    expect(result.recipes).toHaveLength(3)
    expect(result.recipes[0]!.name).toBe('Chickpea Tagine')
    expect(result.recipes[2]!.name).toBe('Stir Fry')
  })
})

// ── reduceToolResultsForFocus ──

describe('reduceToolResultsForFocus', () => {
  const makeResult = (data: unknown): ToolResultEntry => ({
    toolName: 'query_api',
    toolArgs: {},
    data,
    summary: 'test',
  })

  it('truncate-values: reduces data size while keeping all items', async () => {
    const data = {
      products: [
        {
          id: 1,
          title: 'Product',
          description: 'x'.repeat(300),
          image: 'https://cdn.example.com/img.webp',
          reviews: [{ rating: 5, comment: 'Great' }],
        },
      ],
    }
    const results = [makeResult(data)]
    const reduced = await reduceToolResultsForFocus(results, 'test', 'truncate-values')

    const product = (reduced[0]!.data as { products: Array<Record<string, unknown>> }).products[0]!
    expect(product.title).toBe('Product')
    expect((product.description as string).length).toBeLessThan(250)
    expect(product.image).toBe('[url]')
    expect(product.reviews).toBe('1 reviews, avg rating 5.0')
  })

  it('embed-fields: falls back to truncate-values when embedFn not provided', async () => {
    const data = { items: [{ id: 1, title: 'Test', image: 'https://x.com/i.webp' }] }
    const results = [makeResult(data)]
    const reduced = await reduceToolResultsForFocus(results, 'test', 'embed-fields')

    const item = (reduced[0]!.data as { items: Array<Record<string, unknown>> }).items[0]!
    expect(item.image).toBe('[url]')
  })

  it('llm-fields: falls back to truncate-values when llmText not provided', async () => {
    const data = { items: [{ id: 1, title: 'Test', image: 'https://x.com/i.webp' }] }
    const results = [makeResult(data)]
    const reduced = await reduceToolResultsForFocus(results, 'test', 'llm-fields')

    const item = (reduced[0]!.data as { items: Array<Record<string, unknown>> }).items[0]!
    expect(item.image).toBe('[url]')
  })

  it('embed-fields: selects relevant fields when embedFn provided', async () => {
    const data = {
      items: [
        { id: 1, name: 'Apple', category: 'fruit', sku: 'SKU-001', barcode: '123456' },
        { id: 2, name: 'Banana', category: 'fruit', sku: 'SKU-002', barcode: '789012' },
      ],
    }

    // Mock embedFn: query = "fruit", fields = name, category, sku, barcode, id
    // Make name and category score highest
    const mockEmbed = vi.fn().mockResolvedValue([
      [1, 0, 0, 0],     // query: "fruit"
      [0.2, 0, 0, 0],   // id
      [0.9, 0, 0, 0],   // name (high — long string, similar to query)
      [0.95, 0, 0, 0],  // category (highest — matches "fruit")
      [0.1, 0, 0, 0],   // sku (low)
      [0.05, 0, 0, 0],  // barcode (low)
    ])

    const results = [makeResult(data)]
    const reduced = await reduceToolResultsForFocus(results, 'fruit', 'embed-fields', mockEmbed)

    const items = (reduced[0]!.data as { items: Array<Record<string, unknown>> }).items
    expect(items).toHaveLength(2) // All items preserved
    // High-scoring fields present
    expect(items[0]!.name).toBe('Apple')
    expect(items[0]!.category).toBe('fruit')
    // id always included
    expect(items[0]!.id).toBe(1)
  })

  it('llm-fields: uses LLM response to select fields', async () => {
    const data = {
      items: [
        { id: 1, name: 'Apple', category: 'fruit', sku: 'SKU-001', price: 1.99 },
        { id: 2, name: 'Banana', category: 'fruit', sku: 'SKU-002', price: 0.99 },
      ],
    }

    const mockLlmText: LLMTextFn = vi.fn().mockResolvedValue('["name", "category", "price"]')

    const results = [makeResult(data)]
    const reduced = await reduceToolResultsForFocus(results, 'cheap fruit', 'llm-fields', undefined, mockLlmText)

    const items = (reduced[0]!.data as { items: Array<Record<string, unknown>> }).items
    expect(items).toHaveLength(2)
    expect(items[0]!.name).toBe('Apple')
    expect(items[0]!.price).toBe(1.99)
    // id always included even when not selected by LLM
    expect(items[0]!.id).toBe(1)
    // sku not selected
    expect(items[0]!.sku).toBeUndefined()
  })

  it('handles errors gracefully — falls back to raw data', async () => {
    const data = { items: [{ id: 1 }] }
    const failingEmbed = vi.fn().mockRejectedValue(new Error('embed failed'))
    const results = [makeResult(data)]
    const reduced = await reduceToolResultsForFocus(results, 'test', 'embed-fields', failingEmbed)
    // Should fall back to raw data
    expect(reduced[0]!.data).toEqual(data)
  })
})
