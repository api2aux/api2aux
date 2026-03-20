/**
 * Unit tests for the selection orchestration (selectComponent, selectObjectComponent, etc.).
 * Ported from the deleted app/src/services/selection/heuristics.test.ts.
 */

import { describe, it, expect } from 'vitest'
import type { TypeSignature, SemanticMetadata } from '@api2aux/semantic-analysis'
import type { ImportanceScore } from '@api2aux/semantic-analysis'
import {
  selectComponent,
  selectObjectComponent,
  selectPrimitiveArrayComponent,
  getDefaultTypeName,
  SMART_DEFAULT_THRESHOLD,
} from '../../src/select/index'
import type { SelectionContext } from '../../src/select/types'
import { ComponentType, SelectionReason } from '../../src/types'

// ============================================================================
// Helpers
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
// SMART_DEFAULT_THRESHOLD
// ============================================================================

describe('SMART_DEFAULT_THRESHOLD', () => {
  it('is 0.75', () => {
    expect(SMART_DEFAULT_THRESHOLD).toBe(0.75)
  })
})

// ============================================================================
// selectComponent (array orchestration)
// ============================================================================

describe('selectComponent', () => {
  it('priority order: review > gallery > timeline > card-vs-table', () => {
    // Schema with both review pattern AND image pattern
    const schema = createArraySchema([
      { name: 'rating', type: 'number' },
      { name: 'comment', type: 'string' },
      { name: 'image', type: 'string' },
    ])
    const context = createContext(
      [
        { path: '$[].rating', category: 'rating', confidence: 0.9 },
        { path: '$[].image', category: 'image', confidence: 0.9 },
      ],
      [{ path: '$[].comment', tier: 'primary', score: 0.85 }]
    )

    const result = selectComponent(schema, context)

    // Review pattern should win (higher priority)
    expect(result.componentType).toBe(ComponentType.CardList)
    expect(result.reason).toBe(SelectionReason.ReviewPattern)
  })

  it('falls back to type-based default for non-array schemas', () => {
    const schema: TypeSignature = {
      kind: 'object',
      fields: new Map([['name', { type: { kind: 'primitive', type: 'string' } }]]),
    } as TypeSignature

    const result = selectComponent(schema, createContext())

    expect(result.componentType).toBe(ComponentType.Detail)
    expect(result.confidence).toBe(0)
    expect(result.reason).toBe(SelectionReason.NotApplicable)
  })

  it('falls back to table when no heuristic reaches 0.75', () => {
    const schema = createArraySchema([
      { name: 'field1', type: 'string' },
      { name: 'field2', type: 'string' },
    ])
    const context = createContext([], [
      { path: '$[].field1', tier: 'secondary', score: 0.6 },
      { path: '$[].field2', tier: 'secondary', score: 0.6 },
    ])

    const result = selectComponent(schema, context)

    expect(result.componentType).toBe(ComponentType.Table)
    expect(result.confidence).toBe(0)
    expect(result.reason).toBe(SelectionReason.FallbackToDefault)
  })

  it('returns primitive-list type for array of primitives', () => {
    const schema = createPrimitiveArraySchema('string')

    const result = selectComponent(schema, createContext())

    expect(result.componentType).toBe(ComponentType.PrimitiveList)
    expect(result.confidence).toBe(0)
  })
})

// ============================================================================
// selectObjectComponent
// ============================================================================

describe('selectObjectComponent', () => {
  it('profile pattern wins over tabs when both match', () => {
    const schema = createObjectSchema([
      { name: 'name', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'email', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'phone', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'orders', type: { kind: 'array', items: { kind: 'primitive', type: 'string' } } as TypeSignature },
      { name: 'profile', type: { kind: 'object', fields: new Map() } as TypeSignature },
      { name: 'preferences', type: { kind: 'object', fields: new Map() } as TypeSignature },
    ])
    const context = createContext([
      { path: '$.name', category: 'name', confidence: 0.9 },
      { path: '$.email', category: 'email', confidence: 0.9 },
      { path: '$.phone', category: 'phone', confidence: 0.85 },
    ])

    const result = selectObjectComponent(schema, context)

    expect(result.componentType).toBe(ComponentType.Hero)
    expect(result.reason).toBe(SelectionReason.ProfilePattern)
  })

  it('returns tabs when complex pattern matches', () => {
    const schema = createObjectSchema([
      { name: 'name', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'orders', type: { kind: 'array', items: { kind: 'primitive', type: 'string' } } as TypeSignature },
      { name: 'profile', type: { kind: 'object', fields: new Map() } as TypeSignature },
      { name: 'preferences', type: { kind: 'object', fields: new Map() } as TypeSignature },
    ])

    const result = selectObjectComponent(schema, createContext())

    expect(result.componentType).toBe(ComponentType.Tabs)
    expect(result.reason).toBe(SelectionReason.ComplexObject)
  })

  it('returns split when split pattern matches', () => {
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

    const result = selectObjectComponent(schema, context)

    expect(result.componentType).toBe(ComponentType.Split)
    expect(result.reason).toBe(SelectionReason.SplitPattern)
  })

  it('returns detail fallback when no pattern matches', () => {
    const schema = createObjectSchema([
      { name: 'field1', type: { kind: 'primitive', type: 'string' } as TypeSignature },
      { name: 'field2', type: { kind: 'primitive', type: 'string' } as TypeSignature },
    ])

    const result = selectObjectComponent(schema, createContext())

    expect(result.componentType).toBe(ComponentType.Detail)
    expect(result.confidence).toBe(0)
    expect(result.reason).toBe(SelectionReason.FallbackToDefault)
  })

  it('returns detail fallback for non-object schema', () => {
    const schema = createPrimitiveArraySchema('string')

    const result = selectObjectComponent(schema, createContext())

    expect(result.componentType).toBe(ComponentType.Detail)
    expect(result.confidence).toBe(0)
    expect(result.reason).toBe(SelectionReason.FallbackToDefault)
  })
})

// ============================================================================
// selectPrimitiveArrayComponent
// ============================================================================

describe('selectPrimitiveArrayComponent', () => {
  it('returns chips when chips pattern matches', () => {
    const schema = createPrimitiveArraySchema('string')
    const data = ['react', 'vue', 'angular']
    const context = createContext([
      { path: '$.frameworks', category: 'tags', confidence: 0.9 },
    ])

    const result = selectPrimitiveArrayComponent(schema, data, context)

    expect(result.componentType).toBe(ComponentType.Chips)
    expect(result.confidence).toBe(0.9)
    expect(result.reason).toBe(SelectionReason.ChipsPattern)
  })

  it('returns primitive-list fallback when no pattern matches', () => {
    const schema = createPrimitiveArraySchema('string')
    const data = [
      'This is a very long description that exceeds thirty characters',
      'Another long item',
    ]

    const result = selectPrimitiveArrayComponent(schema, data, createContext())

    expect(result.componentType).toBe(ComponentType.PrimitiveList)
    expect(result.confidence).toBe(0)
    expect(result.reason).toBe(SelectionReason.FallbackToDefault)
  })

  it('returns primitive-list with no-data reason when data is empty', () => {
    const schema = createPrimitiveArraySchema('string')

    const result = selectPrimitiveArrayComponent(schema, [], createContext())

    expect(result.componentType).toBe(ComponentType.PrimitiveList)
    expect(result.confidence).toBe(0)
    expect(result.reason).toBe(SelectionReason.NoData)
  })

  it('returns primitive-list for non-primitive-array schema', () => {
    const schema = { kind: 'array', items: { kind: 'object', fields: new Map() } } as TypeSignature

    const result = selectPrimitiveArrayComponent(schema, [], createContext())

    expect(result.componentType).toBe(ComponentType.PrimitiveList)
    expect(result.confidence).toBe(0)
    expect(result.reason).toBe(SelectionReason.FallbackToDefault)
  })

  it('returns grid when image grid pattern matches', () => {
    const schema = createPrimitiveArraySchema('string')
    const data = [
      'https://example.com/a.jpg',
      'https://example.com/b.png',
      'https://example.com/c.webp',
    ]

    const result = selectPrimitiveArrayComponent(schema, data, createContext())

    expect(result.componentType).toBe(ComponentType.Grid)
    expect(result.reason).toBe(SelectionReason.ImageGrid)
  })
})

// ============================================================================
// getDefaultTypeName
// ============================================================================

describe('getDefaultTypeName', () => {
  it('returns table for array of objects', () => {
    const schema = createArraySchema([{ name: 'a', type: 'string' }])
    expect(getDefaultTypeName(schema)).toBe(ComponentType.Table)
  })

  it('returns primitive-list for array of primitives', () => {
    const schema = createPrimitiveArraySchema('string')
    expect(getDefaultTypeName(schema)).toBe(ComponentType.PrimitiveList)
  })

  it('returns detail for object', () => {
    const schema = createObjectSchema([
      { name: 'a', type: { kind: 'primitive', type: 'string' } as TypeSignature },
    ])
    expect(getDefaultTypeName(schema)).toBe(ComponentType.Detail)
  })

  it('returns primitive for primitive', () => {
    const schema = { kind: 'primitive', type: 'string' } as TypeSignature
    expect(getDefaultTypeName(schema)).toBe(ComponentType.Primitive)
  })
})
