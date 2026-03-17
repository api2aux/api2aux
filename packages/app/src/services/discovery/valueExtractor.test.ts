import { describe, it, expect } from 'vitest'
import { extractProbeValues } from './valueExtractor'

describe('extractProbeValues', () => {
  it('extracts string identifiers', () => {
    const data = {
      index: 'acrobatics',
      name: 'Acrobatics',
      ability_score: { index: 'dex', name: 'DEX' },
    }

    const values = extractProbeValues(data)

    expect(values.find(v => v.fieldPath === 'index' && v.value === 'acrobatics')).toBeDefined()
    expect(values.find(v => v.fieldPath === 'ability_score.index' && v.value === 'dex')).toBeDefined()
    expect(values.find(v => v.fieldPath === 'name' && v.value === 'Acrobatics')).toBeDefined()
  })

  it('extracts useful numbers (>= 2)', () => {
    const data = { id: 42, count: 0, flag: 1, score: 100 }
    const values = extractProbeValues(data)

    expect(values.find(v => v.value === 42)).toBeDefined()
    expect(values.find(v => v.value === 100)).toBeDefined()
    expect(values.find(v => v.value === 0)).toBeUndefined()
    expect(values.find(v => v.value === 1)).toBeUndefined()
  })

  it('skips URLs', () => {
    const data = { url: 'https://example.com/api/things', id: 'thing-1' }
    const values = extractProbeValues(data)

    expect(values.find(v => v.value === 'https://example.com/api/things')).toBeUndefined()
    expect(values.find(v => v.value === 'thing-1')).toBeDefined()
  })

  it('skips UUIDs', () => {
    const data = { uuid: '550e8400-e29b-41d4-a716-446655440000', slug: 'my-item' }
    const values = extractProbeValues(data)

    expect(values.find(v => String(v.value).includes('550e8400'))).toBeUndefined()
    expect(values.find(v => v.value === 'my-item')).toBeDefined()
  })

  it('skips ISO dates', () => {
    const data = { created: '2024-01-15T10:00:00Z', code: 'active' }
    const values = extractProbeValues(data)

    expect(values.find(v => String(v.value).includes('2024'))).toBeUndefined()
    expect(values.find(v => v.value === 'active')).toBeDefined()
  })

  it('skips long strings (> 50 chars)', () => {
    const data = {
      description: 'This is a very long description that exceeds fifty characters in length for sure',
      code: 'short',
    }
    const values = extractProbeValues(data)

    expect(values.find(v => String(v.value).length > 50)).toBeUndefined()
    expect(values.find(v => v.value === 'short')).toBeDefined()
  })

  it('respects maxDepth', () => {
    const data = {
      a: { b: { c: { d: { e: 'deep' } } } },
      top: 'shallow',
    }

    const values = extractProbeValues(data, 2)
    expect(values.find(v => v.value === 'deep')).toBeUndefined()
    expect(values.find(v => v.value === 'shallow')).toBeDefined()
  })

  it('respects maxValues', () => {
    const data: Record<string, string> = {}
    for (let i = 0; i < 300; i++) {
      data[`field${i}`] = `val${i}`
    }

    const values = extractProbeValues(data, 3, 50)
    expect(values.length).toBeLessThanOrEqual(50)
  })

  it('samples first few array items', () => {
    const data = {
      results: Array.from({ length: 20 }, (_, i) => ({ index: `item-${i}` })),
    }

    const values = extractProbeValues(data)
    // Should only have values from first 5 items
    const itemValues = values.filter(v => v.fieldPath.startsWith('results['))
    expect(itemValues.length).toBeLessThanOrEqual(5)
  })
})
