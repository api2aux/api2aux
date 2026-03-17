import { describe, it, expect } from 'vitest'
import { detectIdPatterns } from './id-pattern'
import type { InferenceOperation } from '../types'

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

describe('detectIdPatterns', () => {
  it('detects exact name match between response field and path param', () => {
    const ops: InferenceOperation[] = [
      op({
        id: 'list_users',
        path: '/users',
        responseFields: [{ name: 'userId', type: 'string', path: 'userId' }],
      }),
      op({
        id: 'get_user',
        path: '/users/{userId}',
        parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }],
      }),
    ]

    const edges = detectIdPatterns(ops)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.sourceId).toBe('list_users')
    expect(edges[0]!.targetId).toBe('get_user')
    expect(edges[0]!.bindings[0]!.sourceField).toBe('userId')
    expect(edges[0]!.bindings[0]!.targetParam).toBe('userId')
    expect(edges[0]!.bindings[0]!.confidence).toBe(0.9)
  })

  it('detects case-insensitive match', () => {
    const ops: InferenceOperation[] = [
      op({
        id: 'list_items',
        responseFields: [{ name: 'ItemId', type: 'string', path: 'ItemId' }],
      }),
      op({
        id: 'get_item',
        parameters: [{ name: 'itemid', in: 'path', type: 'string', required: true }],
      }),
    ]

    const edges = detectIdPatterns(ops)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.bindings[0]!.confidence).toBe(0.8)
  })

  it('detects normalized match (strip separators)', () => {
    const ops: InferenceOperation[] = [
      op({
        id: 'list_orders',
        responseFields: [{ name: 'order_id', type: 'string', path: 'order_id' }],
      }),
      op({
        id: 'get_order',
        parameters: [{ name: 'orderId', in: 'path', type: 'string', required: true }],
      }),
    ]

    const edges = detectIdPatterns(ops)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.bindings[0]!.confidence).toBe(0.7)
  })

  it('matches generic "id" field to path params', () => {
    const ops: InferenceOperation[] = [
      op({
        id: 'list_products',
        responseFields: [{ name: 'id', type: 'string', path: 'id' }],
      }),
      op({
        id: 'get_product',
        parameters: [{ name: 'productId', in: 'path', type: 'string', required: true }],
      }),
    ]

    const edges = detectIdPatterns(ops)
    expect(edges).toHaveLength(1)
    expect(edges[0]!.bindings[0]!.confidence).toBe(0.75)
  })

  it('does not match operations to themselves', () => {
    const ops: InferenceOperation[] = [
      op({
        id: 'get_user',
        responseFields: [{ name: 'userId', type: 'string', path: 'userId' }],
        parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }],
      }),
    ]

    const edges = detectIdPatterns(ops)
    expect(edges).toHaveLength(0)
  })

  it('does not match unrelated field names', () => {
    const ops: InferenceOperation[] = [
      op({
        id: 'list_users',
        responseFields: [{ name: 'email', type: 'string', path: 'email' }],
      }),
      op({
        id: 'get_user',
        parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }],
      }),
    ]

    const edges = detectIdPatterns(ops)
    expect(edges).toHaveLength(0)
  })
})
