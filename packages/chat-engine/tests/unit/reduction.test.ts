import { describe, it, expect, vi } from 'vitest'
import { truncateValues, reduceToolResultsForFocus, embedFieldSelection, llmFieldSelection } from '../../src/reduction'
import type { ReductionOptions } from '../../src/reduction'
import type { ToolResultEntry, EmbedFn, LLMTextFn } from '../../src/types'
import { FocusReduction } from '../../src/types'

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

  it('preserves URLs intact (not replaced with placeholders)', () => {
    const data = {
      image: 'https://cdn.example.com/image.webp',
      thumbnail: 'https://cdn.example.com/thumb.webp',
      name: 'keep this',
    }
    const result = truncateValues(data) as Record<string, string>
    expect(result.image).toBe('https://cdn.example.com/image.webp')
    expect(result.thumbnail).toBe('https://cdn.example.com/thumb.webp')
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

  it('preserves data:URIs intact', () => {
    const data = { qrCode: 'data:image/png;base64,abc123' }
    const result = truncateValues(data) as Record<string, string>
    expect(result.qrCode).toBe('data:image/png;base64,abc123')
  })

  it('handles empty data', () => {
    expect(truncateValues(null)).toBeNull()
    expect(truncateValues(undefined)).toBeUndefined()
    expect(truncateValues(42)).toBe(42)
    expect(truncateValues('hello')).toBe('hello')
  })

  it('preserves domain-important fields at full length', () => {
    const longMrn = 'MRN-' + 'x'.repeat(300)
    const data = { mrn: longMrn, description: 'y'.repeat(300) }
    const domainFields = new Set(['mrn'])
    const result = truncateValues(data, domainFields) as Record<string, string>
    expect(result.mrn).toBe(longMrn) // preserved
    expect(result.description).toHaveLength(203) // truncated
  })

  it('domain field matching is case-insensitive', () => {
    const longValue = 'x'.repeat(300)
    const data = { MRN: longValue }
    const domainFields = new Set(['mrn'])
    const result = truncateValues(data, domainFields) as Record<string, string>
    expect(result.MRN).toBe(longValue)
  })

  it('preserves domain fields inside arrays of objects', () => {
    const longMrn = 'MRN-' + 'x'.repeat(300)
    const data = {
      patients: [
        { id: 1, mrn: longMrn, notes: 'z'.repeat(300) },
      ],
    }
    const domainFields = new Set(['mrn'])
    const result = truncateValues(data, domainFields) as { patients: Array<Record<string, string>> }
    expect(result.patients[0]!.mrn).toBe(longMrn) // preserved through truncateArray
    expect(result.patients[0]!.notes).toHaveLength(203) // truncated
  })

  it('behaves identically when domainFields is undefined', () => {
    const longStr = 'x'.repeat(300)
    const data = { mrn: longStr }
    const result = truncateValues(data) as Record<string, string>
    expect(result.mrn).toHaveLength(203) // truncated without domain fields
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

  const opts = (overrides?: Partial<ReductionOptions>): ReductionOptions => ({
    strategy: FocusReduction.TruncateValues,
    ...overrides,
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
    const reduced = await reduceToolResultsForFocus(results, 'test', opts())

    const product = (reduced[0]!.data as { products: Array<Record<string, unknown>> }).products[0]!
    expect(product.title).toBe('Product')
    expect((product.description as string).length).toBeLessThan(250)
    expect(product.image).toBe('https://cdn.example.com/img.webp')
    expect(product.reviews).toBe('1 reviews, avg rating 5.0')
  })

  it('handles errors gracefully — falls back to raw data', async () => {
    const data = { items: [{ id: 1 }] }
    const results = [makeResult(data)]
    const reduced = await reduceToolResultsForFocus(results, 'test', opts())
    // truncate-values should work fine on this data
    expect(reduced[0]!.data).toEqual(data)
  })

  it('embed-fields without embedFn throws and falls back to raw data', async () => {
    const data = [{ id: 1, name: 'A', extra: 'B' }]
    const results = [makeResult(data)]
    const onWarning = vi.fn()
    const reduced = await reduceToolResultsForFocus(results, 'test', opts({
      strategy: FocusReduction.EmbedFields,
      onWarning,
    }))
    expect(reduced[0]!.data).toEqual(data) // raw fallback
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('embedFn not provided'))
  })

  it('llm-fields without llmText throws and falls back to raw data', async () => {
    const data = [{ id: 1, name: 'A', extra: 'B' }]
    const results = [makeResult(data)]
    const onWarning = vi.fn()
    const reduced = await reduceToolResultsForFocus(results, 'test', opts({
      strategy: FocusReduction.LlmFields,
      onWarning,
    }))
    expect(reduced[0]!.data).toEqual(data) // raw fallback
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('llmText not provided'))
  })

  it('embed-fields with throwing embedFn falls back to raw data', async () => {
    const data = [{ id: 1, name: 'A' }]
    const results = [makeResult(data)]
    const onWarning = vi.fn()
    const throwingEmbedFn: EmbedFn = async () => { throw new Error('network error') }
    const reduced = await reduceToolResultsForFocus(results, 'test', opts({
      strategy: FocusReduction.EmbedFields,
      embedFn: throwingEmbedFn,
      onWarning,
    }))
    expect(reduced[0]!.data).toEqual(data) // raw fallback
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('network error'))
  })
})

// ── embedFieldSelection ──

describe('embedFieldSelection', () => {
  // Mock embedFn: returns unit vectors where the i-th descriptor vector
  // has a 1.0 in position i and 0.0 elsewhere. The query vector has 1.0
  // in the positions corresponding to the fields we want to rank highest.
  function mockEmbedFn(fieldCount: number, relevantIndices: number[]): EmbedFn {
    return async (texts: string[]) => {
      const dim = fieldCount + 1 // +1 for query
      return texts.map((_, i) => {
        const vec = new Array(dim).fill(0) as number[]
        if (i === 0) {
          // Query vector: activate dimensions for relevant fields
          for (const idx of relevantIndices) vec[idx + 1] = 1.0
        } else {
          // Field descriptor vector: activate own dimension
          vec[i] = 1.0
        }
        return vec
      })
    }
  }

  it('selects top-K fields by cosine similarity', async () => {
    // 12 fields, make fields 0 and 1 relevant (high cosine with query)
    const items = [
      { f0: 'a', f1: 'b', f2: 'c', f3: 'd', f4: 'e', f5: 'f', f6: 'g', f7: 'h', f8: 'i', f9: 'j', f10: 'k', f11: 'l' },
    ]
    const embedFn = mockEmbedFn(12, [0, 1])
    const result = await embedFieldSelection(items, 'test query', embedFn) as Record<string, unknown>[]
    // Should have at most 10 (DEFAULT_FIELD_K) embedding-selected + any always-include
    expect(Object.keys(result[0]!).length).toBeLessThanOrEqual(12)
    expect(Object.keys(result[0]!).length).toBeGreaterThanOrEqual(10)
    // Relevant fields should be included
    expect(result[0]).toHaveProperty('f0')
    expect(result[0]).toHaveProperty('f1')
  })

  it('always-include fields are additive (not counted against K)', async () => {
    // Create data with 'id' and 'name' (always-include) plus 12 other fields
    const item: Record<string, unknown> = { id: 1, name: 'Test' }
    for (let i = 0; i < 12; i++) item[`field${i}`] = `val${i}`
    const items = [item]

    // Make none of the always-include fields relevant by embedding
    const embedFn = mockEmbedFn(14, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) // fields 0-9 of field0-field11
    const result = await embedFieldSelection(items, 'test query', embedFn) as Record<string, unknown>[]
    const keys = Object.keys(result[0]!)
    // Should have 10 (K) embedding-ranked + id + name (additive) = 12
    expect(keys).toContain('id')
    expect(keys).toContain('name')
    expect(keys.length).toBeGreaterThan(10) // more than K because always-include is additive
  })

  it('passes through non-array/non-object data unchanged', async () => {
    const embedFn: EmbedFn = async () => []
    expect(await embedFieldSelection('hello', 'query', embedFn)).toBe('hello')
    expect(await embedFieldSelection(42, 'query', embedFn)).toBe(42)
    expect(await embedFieldSelection(null, 'query', embedFn)).toBeNull()
  })

  it('passes through empty arrays unchanged', async () => {
    const embedFn: EmbedFn = async () => []
    const result = await embedFieldSelection([], 'query', embedFn)
    expect(result).toEqual([])
  })

  it('preserves wrapper object structure', async () => {
    const data = {
      results: [{ id: 1, name: 'A', extra: 'B' }],
      total: 1,
      page: 1,
    }
    const embedFn: EmbedFn = async (texts) =>
      texts.map(() => [1, 0, 0]) // all same vector → all fields equally ranked
    const result = await embedFieldSelection(data, 'query', embedFn) as Record<string, unknown>
    expect(result).toHaveProperty('total', 1)
    expect(result).toHaveProperty('page', 1)
    expect(Array.isArray(result.results)).toBe(true)
  })

  it('throws when embedFn returns wrong number of vectors', async () => {
    const data = [{ id: 1, name: 'A' }]
    const badEmbedFn: EmbedFn = async () => [[1, 0]] // only 1 vector for 3 inputs
    await expect(embedFieldSelection(data, 'query', badEmbedFn))
      .rejects.toThrow('embedFn returned 1 vectors for 3 inputs')
  })

  it('wrapper: selects the largest array when multiple exist', async () => {
    const data = {
      meta: [{ key: 'a' }],
      results: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }],
    }
    const embedFn: EmbedFn = async (texts) =>
      texts.map(() => [1, 0])
    const result = await embedFieldSelection(data, 'query', embedFn) as Record<string, unknown>
    // Should pick 'results' (3 items) over 'meta' (1 item)
    const resultArray = result.results as Record<string, unknown>[]
    expect(resultArray).toHaveLength(3)
  })
})

// ── llmFieldSelection ──

describe('llmFieldSelection', () => {
  const sampleData = [
    { id: 1, name: 'Alice', email: 'alice@test.com', age: 30, department: 'Engineering' },
    { id: 2, name: 'Bob', email: 'bob@test.com', age: 25, department: 'Marketing' },
  ]

  it('filters items to LLM-selected fields', async () => {
    const llmText: LLMTextFn = async () => '["name", "email"]'
    const result = await llmFieldSelection(sampleData, 'find emails', llmText) as Record<string, unknown>[]
    expect(result).toHaveLength(2)
    // Should include LLM-selected fields + always-include (id, name)
    expect(result[0]).toHaveProperty('name', 'Alice')
    expect(result[0]).toHaveProperty('email', 'alice@test.com')
    expect(result[0]).toHaveProperty('id', 1) // always-include
    // Should NOT include non-selected fields
    expect(result[0]).not.toHaveProperty('age')
    expect(result[0]).not.toHaveProperty('department')
  })

  it('falls back to truncateValues when LLM returns non-array', async () => {
    const llmText: LLMTextFn = async () => 'I think you need the name and email fields'
    const onWarning = vi.fn()
    const result = await llmFieldSelection(sampleData, 'query', llmText, onWarning)
    // Should fall back to truncateValues (all fields present, just truncated)
    const items = result as Record<string, unknown>[]
    expect(items[0]).toHaveProperty('id')
    expect(items[0]).toHaveProperty('name')
    expect(items[0]).toHaveProperty('email')
    expect(items[0]).toHaveProperty('age')
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('did not return a field list'))
  })

  it('falls back to truncateValues when LLM returns invalid field names', async () => {
    const llmText: LLMTextFn = async () => '["nonexistent_field", "also_fake"]'
    const onWarning = vi.fn()
    const result = await llmFieldSelection(sampleData, 'query', llmText, onWarning)
    // Should fall back to truncateValues since no valid fields
    const items = result as Record<string, unknown>[]
    expect(items[0]).toHaveProperty('id') // truncateValues preserves all fields
    expect(items[0]).toHaveProperty('name')
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('no valid fields'))
  })

  it('passes domainFields to truncateValues on fallback', async () => {
    const longValue = 'x'.repeat(300)
    const data = [{ id: 1, mrn: longValue, notes: 'y'.repeat(300) }]
    const llmText: LLMTextFn = async () => 'not json'
    const domainFields = new Set(['mrn'])
    const result = await llmFieldSelection(data, 'query', llmText, undefined, domainFields) as Record<string, unknown>[]
    // Domain field should be preserved at full length
    expect(result[0]!.mrn).toBe(longValue)
    // Non-domain field should be truncated
    expect((result[0]!.notes as string).length).toBeLessThan(300)
  })

  it('passes through non-array data unchanged', async () => {
    const llmText: LLMTextFn = async () => '["name"]'
    expect(await llmFieldSelection('hello', 'query', llmText)).toBe('hello')
    expect(await llmFieldSelection(null, 'query', llmText)).toBeNull()
  })

  it('preserves wrapper object structure', async () => {
    const data = {
      users: [{ id: 1, name: 'Alice', email: 'a@b.com' }],
      total: 1,
    }
    const llmText: LLMTextFn = async () => '["name"]'
    const result = await llmFieldSelection(data, 'query', llmText) as Record<string, unknown>
    expect(result).toHaveProperty('total', 1)
    const users = result.users as Record<string, unknown>[]
    expect(users[0]).toHaveProperty('name', 'Alice')
    expect(users[0]).toHaveProperty('id', 1) // always-include
  })

  it('propagates LLM errors (not swallowed)', async () => {
    const llmText: LLMTextFn = async () => { throw new Error('rate limit') }
    await expect(llmFieldSelection(sampleData, 'query', llmText))
      .rejects.toThrow('rate limit')
  })

  it('filters out non-string entries from LLM response', async () => {
    const llmText: LLMTextFn = async () => '["name", 42, null, "email"]'
    const result = await llmFieldSelection(sampleData, 'query', llmText) as Record<string, unknown>[]
    expect(result[0]).toHaveProperty('name')
    expect(result[0]).toHaveProperty('email')
    expect(result[0]).toHaveProperty('id') // always-include
    expect(result[0]).not.toHaveProperty('age')
  })
})
