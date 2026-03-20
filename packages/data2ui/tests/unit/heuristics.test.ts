/**
 * Unit tests for selection heuristics.
 * Ported from app/src/services/selection/heuristics.test.ts with updated
 * imports and reason strings (now SelectionReason enum values).
 */

import { describe, it, expect } from 'vitest'
import type { TypeSignature, SemanticMetadata } from '@api2aux/semantic-analysis'
import type { ImportanceScore } from '@api2aux/semantic-analysis'
import {
  checkReviewPattern,
  checkImageGalleryPattern,
  checkTimelinePattern,
  selectCardOrTable,
  checkProfilePattern,
  checkComplexObjectPattern,
  checkSplitPattern,
  checkChipsPattern,
  checkImageGridPattern,
} from '../../src/select/heuristics'
import type { SelectionContext } from '../../src/select/types'
import { ComponentType, SelectionReason } from '../../src/types'

// ============================================================================
// Mock Helpers
// ============================================================================

function createArraySchema(
  fields: Array<{ name: string; type: string }>
): TypeSignature {
  const fieldMap = new Map()
  for (const field of fields) {
    fieldMap.set(field.name, {
      type: { kind: 'primitive', type: field.type },
      optional: false,
      nullable: false,
      confidence: 'high',
      sampleValues: [],
    })
  }
  return {
    kind: 'array',
    items: { kind: 'object', fields: fieldMap },
  } as TypeSignature
}

function createObjectSchema(
  fields: Array<{ name: string; type: TypeSignature }>
): TypeSignature {
  const fieldMap = new Map()
  for (const field of fields) {
    fieldMap.set(field.name, {
      type: field.type,
      optional: false,
      nullable: false,
      confidence: 'high',
      sampleValues: [],
    })
  }
  return { kind: 'object', fields: fieldMap } as TypeSignature
}

function createPrimitiveArraySchema(primitiveType: string): TypeSignature {
  return {
    kind: 'array',
    items: { kind: 'primitive', type: primitiveType },
  } as TypeSignature
}

function createContext(
  semantics: Array<{ path: string; category: string; confidence: number }> = [],
  importance: Array<{ path: string; tier: 'primary' | 'secondary' | 'tertiary'; score: number }> = []
): SelectionContext {
  const semanticsMap = new Map<string, SemanticMetadata>()
  for (const sem of semantics) {
    semanticsMap.set(sem.path, {
      detectedCategory: sem.category,
      confidence: sem.confidence,
      level: sem.confidence >= 0.75 ? 'high' : 'medium',
      appliedAt: 'smart-default',
      alternatives: [],
    } as SemanticMetadata)
  }

  const importanceMap = new Map<string, ImportanceScore>()
  for (const imp of importance) {
    importanceMap.set(imp.path, {
      tier: imp.tier,
      score: imp.score,
      signals: [],
    } as ImportanceScore)
  }

  return { semantics: semanticsMap, importance: importanceMap }
}

// ============================================================================
// checkReviewPattern
// ============================================================================

describe('checkReviewPattern', () => {
  it('returns card-list when rating + comment fields present', () => {
    const schema = createArraySchema([
      { name: 'rating', type: 'number' },
      { name: 'comment', type: 'string' },
      { name: 'author', type: 'string' },
    ])
    const context = createContext(
      [{ path: '$[].rating', category: 'rating', confidence: 0.9 }],
      [
        { path: '$[].comment', tier: 'primary', score: 0.85 },
        { path: '$[].author', tier: 'secondary', score: 0.6 },
      ]
    )

    const result = checkReviewPattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.CardList)
    expect(result?.confidence).toBe(0.85)
    expect(result?.reason).toBe(SelectionReason.ReviewPattern)
  })

  it('returns card-list when rating + review fields present', () => {
    const schema = createArraySchema([
      { name: 'rating', type: 'number' },
      { name: 'review', type: 'string' },
    ])
    const context = createContext(
      [{ path: '$[].rating', category: 'rating', confidence: 0.9 }],
      [{ path: '$[].review', tier: 'primary', score: 0.9 }]
    )

    const result = checkReviewPattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.CardList)
    expect(result?.confidence).toBe(0.85)
  })

  it('returns card-list when rating + description (primary tier) present', () => {
    const schema = createArraySchema([
      { name: 'rating', type: 'number' },
      { name: 'description', type: 'string' },
    ])
    const context = createContext(
      [
        { path: '$[].rating', category: 'rating', confidence: 0.9 },
        { path: '$[].description', category: 'description', confidence: 0.85 },
      ],
      [{ path: '$[].description', tier: 'primary', score: 0.9 }]
    )

    const result = checkReviewPattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.CardList)
  })

  it('returns card-list when rating + description (secondary tier) present', () => {
    const schema = createArraySchema([
      { name: 'rating', type: 'number' },
      { name: 'description', type: 'string' },
    ])
    const context = createContext(
      [
        { path: '$[].rating', category: 'rating', confidence: 0.9 },
        { path: '$[].description', category: 'description', confidence: 0.8 },
      ],
      [{ path: '$[].description', tier: 'secondary', score: 0.7 }]
    )

    const result = checkReviewPattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.CardList)
  })

  it('returns null when only rating field (no comment)', () => {
    const schema = createArraySchema([
      { name: 'rating', type: 'number' },
      { name: 'author', type: 'string' },
    ])
    const context = createContext([
      { path: '$[].rating', category: 'rating', confidence: 0.9 },
    ])

    expect(checkReviewPattern(schema, context)).toBeNull()
  })

  it('returns null when rating field absent', () => {
    const schema = createArraySchema([
      { name: 'comment', type: 'string' },
      { name: 'author', type: 'string' },
    ])
    const context = createContext([], [
      { path: '$[].comment', tier: 'primary', score: 0.85 },
    ])

    expect(checkReviewPattern(schema, context)).toBeNull()
  })
})

// ============================================================================
// checkImageGalleryPattern
// ============================================================================

describe('checkImageGalleryPattern', () => {
  it('returns gallery when image fields present AND <=4 total fields', () => {
    const schema = createArraySchema([
      { name: 'image', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'caption', type: 'string' },
    ])
    const context = createContext([
      { path: '$[].image', category: 'image', confidence: 0.9 },
    ])

    const result = checkImageGalleryPattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Gallery)
    expect(result?.confidence).toBe(0.9)
    expect(result?.reason).toBe(SelectionReason.ImageGallery)
  })

  it('returns card-list when image + >4 other fields', () => {
    const schema = createArraySchema([
      { name: 'image', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'author', type: 'string' },
      { name: 'date', type: 'string' },
      { name: 'category', type: 'string' },
    ])
    const context = createContext([
      { path: '$[].image', category: 'image', confidence: 0.9 },
    ])

    const result = checkImageGalleryPattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.CardList)
    expect(result?.confidence).toBe(0.75)
    expect(result?.reason).toBe(SelectionReason.ImageWithFields)
  })

  it('returns null when no image fields', () => {
    const schema = createArraySchema([
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
    ])

    expect(checkImageGalleryPattern(schema, createContext())).toBeNull()
  })

  it('handles thumbnail semantic category', () => {
    const schema = createArraySchema([
      { name: 'thumbnail', type: 'string' },
      { name: 'title', type: 'string' },
    ])
    const context = createContext([
      { path: '$[].thumbnail', category: 'thumbnail', confidence: 0.85 },
    ])

    const result = checkImageGalleryPattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Gallery)
  })

  it('handles avatar semantic category', () => {
    const schema = createArraySchema([
      { name: 'avatar', type: 'string' },
      { name: 'name', type: 'string' },
    ])
    const context = createContext([
      { path: '$[].avatar', category: 'avatar', confidence: 0.85 },
    ])

    const result = checkImageGalleryPattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Gallery)
  })

  it('gallery for array of pure image URLs (single field)', () => {
    const schema = createArraySchema([{ name: 'url', type: 'string' }])
    const context = createContext([
      { path: '$[].url', category: 'image', confidence: 0.9 },
    ])

    const result = checkImageGalleryPattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Gallery)
    expect(result?.confidence).toBe(0.9)
  })
})

// ============================================================================
// checkTimelinePattern
// ============================================================================

describe('checkTimelinePattern', () => {
  it('returns timeline when date + title present', () => {
    const schema = createArraySchema([
      { name: 'date', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
    ])
    const context = createContext([
      { path: '$[].date', category: 'date', confidence: 0.9 },
      { path: '$[].title', category: 'title', confidence: 0.85 },
    ])

    const result = checkTimelinePattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Timeline)
    expect(result?.confidence).toBe(0.8)
    expect(result?.reason).toBe(SelectionReason.TimelinePattern)
  })

  it('returns timeline when timestamp + description present', () => {
    const schema = createArraySchema([
      { name: 'timestamp', type: 'number' },
      { name: 'description', type: 'string' },
    ])
    const context = createContext([
      { path: '$[].timestamp', category: 'timestamp', confidence: 0.9 },
      { path: '$[].description', category: 'description', confidence: 0.85 },
    ])

    const result = checkTimelinePattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Timeline)
    expect(result?.confidence).toBe(0.8)
  })

  it('returns null when only date field (no title/description)', () => {
    const schema = createArraySchema([
      { name: 'date', type: 'string' },
      { name: 'value', type: 'number' },
    ])
    const context = createContext([
      { path: '$[].date', category: 'date', confidence: 0.9 },
    ])

    expect(checkTimelinePattern(schema, context)).toBeNull()
  })

  it('returns null when only title (no date)', () => {
    const schema = createArraySchema([
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
    ])
    const context = createContext([
      { path: '$[].title', category: 'title', confidence: 0.85 },
    ])

    expect(checkTimelinePattern(schema, context)).toBeNull()
  })
})

// ============================================================================
// selectCardOrTable
// ============================================================================

describe('selectCardOrTable', () => {
  it('returns card-list for <=8 visible fields with rich content', () => {
    const schema = createArraySchema([
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'image', type: 'string' },
      { name: 'author', type: 'string' },
      { name: 'date', type: 'string' },
      { name: 'id', type: 'string' },
    ])
    const context = createContext(
      [
        { path: '$[].title', category: 'title', confidence: 0.9 },
        { path: '$[].description', category: 'description', confidence: 0.85 },
        { path: '$[].image', category: 'image', confidence: 0.9 },
      ],
      [
        { path: '$[].title', tier: 'primary', score: 0.9 },
        { path: '$[].description', tier: 'primary', score: 0.85 },
        { path: '$[].image', tier: 'primary', score: 0.9 },
        { path: '$[].author', tier: 'secondary', score: 0.7 },
        { path: '$[].date', tier: 'secondary', score: 0.65 },
        { path: '$[].id', tier: 'tertiary', score: 0.3 },
      ]
    )

    const result = selectCardOrTable(schema, context)

    expect(result.componentType).toBe(ComponentType.CardList)
    expect(result.confidence).toBe(0.75)
    expect(result.reason).toBe(SelectionReason.CardHeuristic)
  })

  it('returns table for >=10 visible fields', () => {
    const fields = Array.from({ length: 12 }, (_, i) => ({
      name: `field${i}`,
      type: 'string',
    }))
    const schema = createArraySchema(fields)
    const importance = fields.map((f) => ({
      path: `$[].${f.name}`,
      tier: 'primary' as const,
      score: 0.8,
    }))
    const context = createContext([], importance)

    const result = selectCardOrTable(schema, context)

    expect(result.componentType).toBe(ComponentType.Table)
    expect(result.confidence).toBe(0.8)
    expect(result.reason).toBe(SelectionReason.HighFieldCount)
  })

  it('returns table with 0.5 for ambiguous (no rich content, moderate fields)', () => {
    const fields = Array.from({ length: 9 }, (_, i) => ({
      name: `field${i}`,
      type: 'string',
    }))
    const schema = createArraySchema(fields)
    const importance = fields.map((f) => ({
      path: `$[].${f.name}`,
      tier: 'secondary' as const,
      score: 0.6,
    }))
    const context = createContext([], importance)

    const result = selectCardOrTable(schema, context)

    expect(result.componentType).toBe(ComponentType.Table)
    expect(result.confidence).toBe(0.5)
    expect(result.reason).toBe(SelectionReason.FallbackToDefault)
  })

  it('counts only primary + secondary tier fields (ignores tertiary)', () => {
    const schema = createArraySchema([
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'id', type: 'string' },
      { name: 'created_at', type: 'string' },
      { name: 'updated_at', type: 'string' },
    ])
    const context = createContext(
      [
        { path: '$[].title', category: 'title', confidence: 0.9 },
        { path: '$[].description', category: 'description', confidence: 0.85 },
      ],
      [
        { path: '$[].title', tier: 'primary', score: 0.9 },
        { path: '$[].description', tier: 'primary', score: 0.85 },
        { path: '$[].id', tier: 'tertiary', score: 0.3 },
        { path: '$[].created_at', tier: 'tertiary', score: 0.25 },
        { path: '$[].updated_at', tier: 'tertiary', score: 0.2 },
      ]
    )

    const result = selectCardOrTable(schema, context)

    // Only 2 visible fields (both primary), has rich content
    expect(result.componentType).toBe(ComponentType.CardList)
  })

  it('content richness trumps field count (12 fields but 8 tertiary = cards)', () => {
    const schema = createArraySchema([
      { name: 'title', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'image', type: 'string' },
      { name: 'author', type: 'string' },
      ...Array.from({ length: 8 }, (_, i) => ({
        name: `meta${i}`,
        type: 'string',
      })),
    ])
    const context = createContext(
      [
        { path: '$[].title', category: 'title', confidence: 0.9 },
        { path: '$[].description', category: 'description', confidence: 0.85 },
        { path: '$[].image', category: 'image', confidence: 0.9 },
      ],
      [
        { path: '$[].title', tier: 'primary', score: 0.9 },
        { path: '$[].description', tier: 'primary', score: 0.85 },
        { path: '$[].image', tier: 'primary', score: 0.9 },
        { path: '$[].author', tier: 'secondary', score: 0.6 },
        ...Array.from({ length: 8 }, (_, i) => ({
          path: `$[].meta${i}`,
          tier: 'tertiary' as const,
          score: 0.3,
        })),
      ]
    )

    const result = selectCardOrTable(schema, context)

    // Only 4 visible fields (3 primary + 1 secondary), rich content
    expect(result.componentType).toBe(ComponentType.CardList)
  })

  it('empty field list returns table fallback', () => {
    const schema = createArraySchema([])
    const result = selectCardOrTable(schema, createContext())

    expect(result.componentType).toBe(ComponentType.Table)
    expect(result.confidence).toBe(0.5)
  })
})

// ============================================================================
// checkProfilePattern (object heuristic)
// ============================================================================

describe('checkProfilePattern', () => {
  it('returns hero when name + 2+ contact fields present', () => {
    const schema = createObjectSchema([
      { name: 'name', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'email', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'phone', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'bio', type: { kind: 'primitive', type: 'string' } as TypeSignature },
    ])
    const context = createContext([
      { path: '$.name', category: 'name', confidence: 0.9 },
      { path: '$.email', category: 'email', confidence: 0.9 },
      { path: '$.phone', category: 'phone', confidence: 0.85 },
    ])

    const result = checkProfilePattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Hero)
    expect(result?.confidence).toBe(0.85)
    expect(result?.reason).toBe(SelectionReason.ProfilePattern)
  })

  it('returns hero with full_name regex match', () => {
    const schema = createObjectSchema([
      { name: 'full_name', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'email', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'address', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'website', type: { kind: 'primitive', type: 'string' } as TypeSignature },
    ])
    const context = createContext([
      { path: '$.email', category: 'email', confidence: 0.9 },
      { path: '$.address', category: 'address', confidence: 0.85 },
      { path: '$.website', category: 'url', confidence: 0.8 },
    ])

    const result = checkProfilePattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Hero)
  })

  it('returns null when name + only 1 contact field', () => {
    const schema = createObjectSchema([
      { name: 'name', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'email', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'bio', type: { kind: 'primitive', type: 'string' } as TypeSignature },
    ])
    const context = createContext([
      { path: '$.name', category: 'name', confidence: 0.9 },
      { path: '$.email', category: 'email', confidence: 0.9 },
    ])

    expect(checkProfilePattern(schema, context)).toBeNull()
  })

  it('returns null when no name field', () => {
    const schema = createObjectSchema([
      { name: 'email', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'phone', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'address', type: { kind: 'primitive', type: 'string' } as TypeSignature },
    ])
    const context = createContext([
      { path: '$.email', category: 'email', confidence: 0.9 },
      { path: '$.phone', category: 'phone', confidence: 0.85 },
      { path: '$.address', category: 'address', confidence: 0.85 },
    ])

    expect(checkProfilePattern(schema, context)).toBeNull()
  })

  it('returns null for non-object schema', () => {
    const schema = { kind: 'array', items: { kind: 'primitive', type: 'string' } } as TypeSignature
    expect(checkProfilePattern(schema, createContext())).toBeNull()
  })

  it('detects name from field name regex when no semantic', () => {
    const schema = createObjectSchema([
      { name: 'title', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'email', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'phone', type: { kind: 'primitive', type: 'string' } as TypeSignature },
    ])
    const context = createContext([
      { path: '$.email', category: 'email', confidence: 0.9 },
      { path: '$.phone', category: 'phone', confidence: 0.85 },
    ])

    const result = checkProfilePattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Hero)
  })
})

// ============================================================================
// checkComplexObjectPattern (object heuristic)
// ============================================================================

describe('checkComplexObjectPattern', () => {
  it('returns tabs when 3+ nested object/array fields', () => {
    const schema = createObjectSchema([
      { name: 'name', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'orders', type: { kind: 'array', items: { kind: 'primitive', type: 'string' } } as TypeSignature },
      { name: 'profile', type: { kind: 'object', fields: new Map() } as TypeSignature },
      { name: 'preferences', type: { kind: 'object', fields: new Map() } as TypeSignature },
    ])

    const result = checkComplexObjectPattern(schema, createContext())

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Tabs)
    expect(result?.confidence).toBe(0.8)
    expect(result?.reason).toBe(SelectionReason.ComplexObject)
  })

  it('returns null when only 2 nested fields', () => {
    const schema = createObjectSchema([
      { name: 'name', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'orders', type: { kind: 'array', items: { kind: 'primitive', type: 'string' } } as TypeSignature },
      { name: 'profile', type: { kind: 'object', fields: new Map() } as TypeSignature },
    ])

    expect(checkComplexObjectPattern(schema, createContext())).toBeNull()
  })

  it('returns null for non-object schema', () => {
    const schema = { kind: 'primitive', type: 'string' } as TypeSignature
    expect(checkComplexObjectPattern(schema, createContext())).toBeNull()
  })

  it('counts mixed nested types (objects and arrays)', () => {
    const schema = createObjectSchema([
      { name: 'metadata', type: { kind: 'object', fields: new Map() } as TypeSignature },
      { name: 'tags', type: { kind: 'array', items: { kind: 'primitive', type: 'string' } } as TypeSignature },
      { name: 'related', type: { kind: 'array', items: { kind: 'object', fields: new Map() } } as TypeSignature },
    ])

    const result = checkComplexObjectPattern(schema, createContext())

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Tabs)
  })
})

// ============================================================================
// checkSplitPattern (object heuristic)
// ============================================================================

describe('checkSplitPattern', () => {
  it('returns split when 1 primary content + 3+ metadata fields + 5+ total', () => {
    const schema = createObjectSchema([
      { name: 'description', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'name', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'id', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'created_at', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'updated_at', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: '_version', type: { kind: 'primitive', type: 'number' } as TypeSignature },
    ])
    const context = createContext(
      [{ path: '$.description', category: 'description', confidence: 0.9 }],
      [
        { path: '$.description', tier: 'primary', score: 0.85 },
        { path: '$.name', tier: 'secondary', score: 0.7 },
        { path: '$.id', tier: 'tertiary', score: 0.3 },
        { path: '$.created_at', tier: 'tertiary', score: 0.25 },
        { path: '$.updated_at', tier: 'tertiary', score: 0.2 },
        { path: '$._version', tier: 'tertiary', score: 0.15 },
      ]
    )

    const result = checkSplitPattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Split)
    expect(result?.confidence).toBe(0.75)
    expect(result?.reason).toBe(SelectionReason.SplitPattern)
  })

  it('detects content field from name regex (body, summary, text)', () => {
    const schema = createObjectSchema([
      { name: 'body', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'title', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'id', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'timestamp', type: { kind: 'primitive', type: 'number' } as TypeSignature },
      { name: 'created', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'updated', type: { kind: 'primitive', type: 'string' } as TypeSignature },
    ])
    const context = createContext([], [
      { path: '$.body', tier: 'primary', score: 0.9 },
      { path: '$.title', tier: 'secondary', score: 0.7 },
      { path: '$.id', tier: 'tertiary', score: 0.3 },
      { path: '$.timestamp', tier: 'tertiary', score: 0.25 },
      { path: '$.created', tier: 'tertiary', score: 0.2 },
      { path: '$.updated', tier: 'tertiary', score: 0.15 },
    ])

    const result = checkSplitPattern(schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Split)
  })

  it('returns null when no primary content field', () => {
    const schema = createObjectSchema([
      { name: 'name', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'value', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'id', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'created_at', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'updated_at', type: { kind: 'primitive', type: 'string' } as TypeSignature },
    ])
    const context = createContext([], [
      { path: '$.name', tier: 'secondary', score: 0.7 },
      { path: '$.value', tier: 'secondary', score: 0.65 },
      { path: '$.id', tier: 'tertiary', score: 0.3 },
      { path: '$.created_at', tier: 'tertiary', score: 0.25 },
      { path: '$.updated_at', tier: 'tertiary', score: 0.2 },
    ])

    expect(checkSplitPattern(schema, context)).toBeNull()
  })

  it('returns null when <3 metadata fields', () => {
    const schema = createObjectSchema([
      { name: 'description', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'name', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'id', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'created_at', type: { kind: 'primitive', type: 'string' } as TypeSignature },
    ])
    const context = createContext(
      [{ path: '$.description', category: 'description', confidence: 0.9 }],
      [
        { path: '$.description', tier: 'primary', score: 0.85 },
        { path: '$.name', tier: 'secondary', score: 0.7 },
        { path: '$.id', tier: 'tertiary', score: 0.3 },
        { path: '$.created_at', tier: 'tertiary', score: 0.25 },
      ]
    )

    expect(checkSplitPattern(schema, context)).toBeNull()
  })

  it('returns null when <5 total fields', () => {
    const schema = createObjectSchema([
      { name: 'description', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'id', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'created', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'updated', type: { kind: 'primitive', type: 'string' } as TypeSignature },
    ])
    const context = createContext(
      [{ path: '$.description', category: 'description', confidence: 0.9 }],
      [
        { path: '$.description', tier: 'primary', score: 0.85 },
        { path: '$.id', tier: 'tertiary', score: 0.3 },
        { path: '$.created', tier: 'tertiary', score: 0.25 },
        { path: '$.updated', tier: 'tertiary', score: 0.2 },
      ]
    )

    expect(checkSplitPattern(schema, context)).toBeNull()
  })
})

// ============================================================================
// checkChipsPattern (primitive array heuristic)
// ============================================================================

describe('checkChipsPattern', () => {
  it('returns chips with 0.9 for semantic tags category', () => {
    const schema = createPrimitiveArraySchema('string')
    const data = ['react', 'typescript', 'nextjs']
    const context = createContext([
      { path: '$.tags', category: 'tags', confidence: 0.9 },
    ])

    const result = checkChipsPattern(data, schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Chips)
    expect(result?.confidence).toBe(0.9)
    expect(result?.reason).toBe(SelectionReason.ChipsPattern)
  })

  it('returns chips with 0.9 for semantic status category', () => {
    const schema = createPrimitiveArraySchema('string')
    const data = ['active', 'pending', 'completed']
    const context = createContext([
      { path: '$.statuses', category: 'status', confidence: 0.85 },
    ])

    const result = checkChipsPattern(data, schema, context)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Chips)
    expect(result?.confidence).toBe(0.9)
  })

  it('returns chips with 0.8 for short enum-like values', () => {
    const schema = createPrimitiveArraySchema('string')
    const data = ['Small', 'Medium', 'Large', 'XL']

    const result = checkChipsPattern(data, schema, createContext())

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Chips)
    expect(result?.confidence).toBe(0.8)
  })

  it('returns null for long values', () => {
    const schema = createPrimitiveArraySchema('string')
    const data = [
      'This is a very long description that exceeds the maximum length',
      'Another long description',
    ]

    expect(checkChipsPattern(data, schema, createContext())).toBeNull()
  })

  it('returns null for non-string primitive arrays', () => {
    const schema = createPrimitiveArraySchema('number')
    const data = [1, 2, 3, 4, 5]

    expect(checkChipsPattern(data, schema, createContext())).toBeNull()
  })

  it('returns null for empty data', () => {
    const schema = createPrimitiveArraySchema('string')

    expect(checkChipsPattern([], schema, createContext())).toBeNull()
  })

  it('returns null when array length >10', () => {
    const schema = createPrimitiveArraySchema('string')
    const data = Array(11).fill('tag')

    expect(checkChipsPattern(data, schema, createContext())).toBeNull()
  })
})

// ============================================================================
// checkImageGridPattern (primitive array heuristic)
// ============================================================================

describe('checkImageGridPattern', () => {
  it('returns grid when >=50% items are image URLs', () => {
    const schema = createPrimitiveArraySchema('string')
    const data = [
      'https://example.com/img1.jpg',
      'https://example.com/img2.png',
      'https://example.com/img3.webp',
    ]

    const result = checkImageGridPattern(data, schema)

    expect(result).not.toBeNull()
    expect(result?.componentType).toBe(ComponentType.Grid)
    expect(result?.confidence).toBe(0.85)
    expect(result?.reason).toBe(SelectionReason.ImageGrid)
  })

  it('returns null when <50% are image URLs', () => {
    const schema = createPrimitiveArraySchema('string')
    const data = [
      'https://example.com/img1.jpg',
      'not-an-image',
      'also-not-an-image',
    ]

    expect(checkImageGridPattern(data, schema)).toBeNull()
  })

  it('returns null for empty data', () => {
    const schema = createPrimitiveArraySchema('string')
    expect(checkImageGridPattern([], schema)).toBeNull()
  })

  it('returns null for non-string primitive arrays', () => {
    const schema = createPrimitiveArraySchema('number')
    expect(checkImageGridPattern([1, 2, 3], schema)).toBeNull()
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe('edge cases', () => {
  it('schema with primitive array items handled gracefully', () => {
    const schema = { kind: 'array', items: { kind: 'primitive', type: 'string' } } as TypeSignature
    expect(checkReviewPattern(schema, createContext())).toBeNull()
  })

  it('context with empty maps handled gracefully', () => {
    const schema = createArraySchema([
      { name: 'field1', type: 'string' },
      { name: 'field2', type: 'string' },
    ])
    const context: SelectionContext = {
      semantics: new Map(),
      importance: new Map(),
    }

    expect(checkReviewPattern(schema, context)).toBeNull()
    expect(checkImageGalleryPattern(schema, context)).toBeNull()
    expect(checkTimelinePattern(schema, context)).toBeNull()
    expect(selectCardOrTable(schema, context).componentType).toBe(ComponentType.Table)
  })
})
