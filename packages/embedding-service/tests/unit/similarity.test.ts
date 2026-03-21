import { describe, it, expect } from 'vitest'
import { cosineSimilarity, topK } from '../../src/similarity'

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0)
  })

  it('returns 0.0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0)
  })

  it('returns -1.0 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0)
  })

  it('handles normalized vectors correctly', () => {
    const a = [0.6, 0.8]
    const b = [0.8, 0.6]
    const sim = cosineSimilarity(a, b)
    expect(sim).toBeGreaterThan(0.9)
    expect(sim).toBeLessThan(1.0)
  })

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
  })
})

describe('topK', () => {
  const queryVector = [1, 0, 0]

  it('returns indices sorted by similarity (highest first)', () => {
    const items = [
      [0, 1, 0],  // orthogonal → 0
      [1, 0, 0],  // identical → 1
      [0.5, 0.5, 0], // partial → ~0.7
    ]

    const result = topK(queryVector, items, 3)
    expect(result.indices).toEqual([1, 2, 0])
    expect(result.scores[0]).toBeCloseTo(1.0)
  })

  it('returns only K items when K < items.length', () => {
    const items = [
      [0, 1, 0],
      [1, 0, 0],
      [0.5, 0.5, 0],
      [0.9, 0.1, 0],
    ]

    const result = topK(queryVector, items, 2)
    expect(result.indices).toHaveLength(2)
    expect(result.scores).toHaveLength(2)
    // Top 2 should be the most similar
    expect(result.indices[0]).toBe(1) // identical
    expect(result.indices[1]).toBe(3) // 0.9, 0.1
  })

  it('returns all items when K > items.length', () => {
    const items = [[1, 0, 0], [0, 1, 0]]
    const result = topK(queryVector, items, 10)
    expect(result.indices).toHaveLength(2)
  })

  it('handles empty items array', () => {
    const result = topK(queryVector, [], 5)
    expect(result.indices).toEqual([])
    expect(result.scores).toEqual([])
  })
})
