import { describe, it, expect } from 'vitest'
import { matchRuntimeValues } from './runtime-value-match'
import type { InferenceOperation, RuntimeProbeResult } from '../types'

function op(overrides: Partial<InferenceOperation> & { id: string }): InferenceOperation {
  return {
    path: '/test',
    method: 'GET',
    tags: [],
    parameters: [],
    responseFields: [],
    requestBodyFields: [],
    ...overrides,
  }
}

describe('matchRuntimeValues', () => {
  it('discovers cross-resource edge via cross-probe matching (D&D example)', () => {
    // Skills endpoint returns ability_score.index = "dex"
    // Ability-scores list returns items with index: "dex", "str", etc.
    // Ability-scores detail has {index} path param
    const operations: InferenceOperation[] = [
      op({
        id: 'get_skill',
        path: '/api/skills/{index}',
        method: 'GET',
        tags: ['Skills'],
        parameters: [{ name: 'index', in: 'path', type: 'string', required: true }],
        responseFields: [
          { name: 'index', type: 'string', path: 'index' },
          { name: 'name', type: 'string', path: 'name' },
          { name: 'index', type: 'string', path: 'ability_score.index' },
          { name: 'name', type: 'string', path: 'ability_score.name' },
          { name: 'url', type: 'string', path: 'ability_score.url' },
        ],
      }),
      op({
        id: 'list_ability_scores',
        path: '/api/ability-scores',
        method: 'GET',
        tags: ['Ability Scores'],
        parameters: [],
        responseFields: [
          { name: 'index', type: 'string', path: 'index' },
          { name: 'name', type: 'string', path: 'name' },
          { name: 'url', type: 'string', path: 'url' },
        ],
      }),
      op({
        id: 'get_ability_score',
        path: '/api/ability-scores/{index}',
        method: 'GET',
        tags: ['Ability Scores'],
        parameters: [{ name: 'index', in: 'path', type: 'string', required: true }],
        responseFields: [
          { name: 'index', type: 'string', path: 'index' },
          { name: 'name', type: 'string', path: 'name' },
          { name: 'full_name', type: 'string', path: 'full_name' },
        ],
      }),
    ]

    // Probe results: skills returns ability_score.index = "dex",
    // ability-scores list returns items with index: "dex", "str", "con"
    const probeResults: RuntimeProbeResult[] = [
      {
        operationId: 'get_skill',
        success: true,
        values: [
          { fieldPath: 'index', value: 'acrobatics', type: 'string' },
          { fieldPath: 'name', value: 'Acrobatics', type: 'string' },
          { fieldPath: 'ability_score.index', value: 'dex', type: 'string' },
          { fieldPath: 'ability_score.name', value: 'DEX', type: 'string' },
        ],
      },
      {
        operationId: 'list_ability_scores',
        success: true,
        values: [
          { fieldPath: 'index', value: 'dex', type: 'string' },
          { fieldPath: 'name', value: 'DEX', type: 'string' },
          { fieldPath: 'index', value: 'str', type: 'string' },
          { fieldPath: 'name', value: 'STR', type: 'string' },
          { fieldPath: 'index', value: 'con', type: 'string' },
          { fieldPath: 'name', value: 'CON', type: 'string' },
        ],
      },
    ]

    const edges = matchRuntimeValues(probeResults, operations)

    // Should find: get_skill → get_ability_score (via ability_score.index → index)
    const skillToAbility = edges.find(
      e => e.sourceId === 'get_skill' && e.targetId === 'get_ability_score'
    )
    expect(skillToAbility).toBeDefined()
    expect(skillToAbility!.bindings.length).toBeGreaterThan(0)
    expect(skillToAbility!.bindings.some(
      b => b.sourceField === 'ability_score.index' && b.targetParam === 'index'
    )).toBe(true)
    expect(skillToAbility!.signals[0]!.signal).toBe('runtime-value-match')
  })

  it('matches value against param enum with high confidence', () => {
    const operations: InferenceOperation[] = [
      op({
        id: 'get_product',
        path: '/products/{id}',
        method: 'GET',
        responseFields: [
          { name: 'category', type: 'string', path: 'category' },
        ],
      }),
      op({
        id: 'list_by_category',
        path: '/categories/{slug}',
        method: 'GET',
        parameters: [{
          name: 'slug',
          in: 'path',
          type: 'string',
          required: true,
          enum: ['electronics', 'books', 'clothing'],
        }],
      }),
    ]

    const probeResults: RuntimeProbeResult[] = [
      {
        operationId: 'get_product',
        success: true,
        values: [
          { fieldPath: 'category', value: 'electronics', type: 'string' },
        ],
      },
    ]

    const edges = matchRuntimeValues(probeResults, operations)
    const edge = edges.find(e => e.sourceId === 'get_product' && e.targetId === 'list_by_category')
    expect(edge).toBeDefined()
    expect(edge!.bindings[0]!.confidence).toBe(0.95)
  })

  it('matches value against param example', () => {
    const operations: InferenceOperation[] = [
      op({
        id: 'get_order',
        path: '/orders/{id}',
        method: 'GET',
        responseFields: [
          { name: 'userId', type: 'string', path: 'userId' },
        ],
      }),
      op({
        id: 'get_user',
        path: '/users/{userId}',
        method: 'GET',
        parameters: [{
          name: 'userId',
          in: 'path',
          type: 'string',
          required: true,
          example: 'user-42',
        }],
      }),
    ]

    const probeResults: RuntimeProbeResult[] = [
      {
        operationId: 'get_order',
        success: true,
        values: [
          { fieldPath: 'userId', value: 'user-42', type: 'string' },
        ],
      },
    ]

    const edges = matchRuntimeValues(probeResults, operations)
    const edge = edges.find(e => e.sourceId === 'get_order' && e.targetId === 'get_user')
    expect(edge).toBeDefined()
    expect(edge!.bindings[0]!.confidence).toBe(0.85)
  })

  it('skips failed probes', () => {
    const operations: InferenceOperation[] = [
      op({
        id: 'get_item',
        path: '/items/{id}',
        method: 'GET',
        parameters: [{ name: 'id', in: 'path', type: 'string', required: true }],
      }),
    ]

    const probeResults: RuntimeProbeResult[] = [
      {
        operationId: 'get_item',
        success: false,
        values: [],
      },
    ]

    const edges = matchRuntimeValues(probeResults, operations)
    expect(edges).toEqual([])
  })

  it('suppresses number cross-probe matches when field name does not match param name', () => {
    // Cross-probe match gives 0.80 confidence (below 0.90 threshold),
    // so the number false-positive filter checks field name vs param name
    const operations: InferenceOperation[] = [
      op({
        id: 'get_product',
        path: '/products/{id}',
        method: 'GET',
        responseFields: [{ name: 'count', type: 'integer', path: 'count' }],
      }),
      op({
        id: 'list_categories',
        path: '/categories',
        method: 'GET',
        responseFields: [{ name: 'id', type: 'integer', path: 'id' }],
      }),
      op({
        id: 'get_category',
        path: '/categories/{id}',
        method: 'GET',
        parameters: [{
          name: 'id',
          in: 'path',
          type: 'integer',
          required: true,
        }],
      }),
    ]

    const probeResults: RuntimeProbeResult[] = [
      {
        operationId: 'get_product',
        success: true,
        values: [{ fieldPath: 'count', value: 3, type: 'number' }],
      },
      {
        operationId: 'list_categories',
        success: true,
        values: [{ fieldPath: 'id', value: 3, type: 'number' }],
      },
    ]

    const edges = matchRuntimeValues(probeResults, operations)
    // count=3 from get_product matches via cross-probe (3 appears in list_categories under "id")
    // but field "count" does not match param "id", so the number filter should suppress this
    const edge = edges.find(e => e.sourceId === 'get_product' && e.targetId === 'get_category')
    expect(edge).toBeUndefined()
  })

  it('allows number enum matches regardless of field name (confidence >= 0.90)', () => {
    // Enum match gives 0.95 confidence, above the 0.90 threshold,
    // so the name similarity check is bypassed even for numbers
    const operations: InferenceOperation[] = [
      op({
        id: 'get_product',
        path: '/products/{id}',
        method: 'GET',
        responseFields: [{ name: 'categoryId', type: 'integer', path: 'categoryId' }],
      }),
      op({
        id: 'get_category',
        path: '/categories/{id}',
        method: 'GET',
        parameters: [{
          name: 'id',
          in: 'path',
          type: 'integer',
          required: true,
          enum: [42],
        }],
      }),
    ]

    const probeResults: RuntimeProbeResult[] = [
      {
        operationId: 'get_product',
        success: true,
        values: [{ fieldPath: 'categoryId', value: 42, type: 'number' }],
      },
    ]

    const edges = matchRuntimeValues(probeResults, operations)
    const edge = edges.find(e => e.sourceId === 'get_product' && e.targetId === 'get_category')
    // Enum match (0.95) is above 0.90 threshold, so name check is bypassed
    expect(edge).toBeDefined()
    expect(edge!.bindings[0]!.confidence).toBe(0.95)
  })

  it('deduplicates bindings per param, keeping highest confidence', () => {
    const operations: InferenceOperation[] = [
      op({
        id: 'get_order',
        path: '/orders/{id}',
        method: 'GET',
        responseFields: [
          { name: 'userId', type: 'string', path: 'userId' },
          { name: 'createdBy', type: 'string', path: 'createdBy' },
        ],
      }),
      op({
        id: 'get_user',
        path: '/users/{userId}',
        method: 'GET',
        parameters: [{
          name: 'userId',
          in: 'path',
          type: 'string',
          required: true,
          example: 'user-42',
          enum: ['user-42', 'user-99'],
        }],
      }),
    ]

    const probeResults: RuntimeProbeResult[] = [
      {
        operationId: 'get_order',
        success: true,
        values: [
          // Both values match the same param via different tiers
          { fieldPath: 'userId', value: 'user-42', type: 'string' },     // matches enum (0.95) AND example (0.85)
          { fieldPath: 'createdBy', value: 'user-42', type: 'string' },  // also matches enum (0.95)
        ],
      },
    ]

    const edges = matchRuntimeValues(probeResults, operations)
    const edge = edges.find(e => e.sourceId === 'get_order' && e.targetId === 'get_user')
    expect(edge).toBeDefined()
    // Should have only one binding for userId param (deduplicated)
    const userIdBindings = edge!.bindings.filter(b => b.targetParam === 'userId')
    expect(userIdBindings).toHaveLength(1)
    // Should keep the highest confidence (0.95 from enum match)
    expect(userIdBindings[0]!.confidence).toBe(0.95)
  })

  it('does not create self-edges', () => {
    const operations: InferenceOperation[] = [
      op({
        id: 'get_item',
        path: '/items/{id}',
        method: 'GET',
        parameters: [{
          name: 'id',
          in: 'path',
          type: 'string',
          required: true,
          enum: ['abc'],
        }],
        responseFields: [
          { name: 'id', type: 'string', path: 'id' },
        ],
      }),
    ]

    const probeResults: RuntimeProbeResult[] = [
      {
        operationId: 'get_item',
        success: true,
        values: [{ fieldPath: 'id', value: 'abc', type: 'string' }],
      },
    ]

    const edges = matchRuntimeValues(probeResults, operations)
    expect(edges).toEqual([])
  })
})
