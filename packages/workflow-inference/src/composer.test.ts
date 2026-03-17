import { describe, it, expect, beforeEach } from 'vitest'
import { inferWorkflows, resetWorkflowCounter } from './composer'
import { buildOperationGraph } from './graph'
import { WorkflowPattern } from './types'
import type { InferenceOperation } from './types'

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

beforeEach(() => {
  resetWorkflowCounter()
})

describe('inferWorkflows', () => {
  it('detects a Browse workflow (list → detail)', () => {
    const operations: InferenceOperation[] = [
      op({
        id: 'list_products',
        path: '/products',
        method: 'GET',
        tags: ['products'],
        responseFields: [
          { name: 'id', type: 'string', path: 'id' },
          { name: 'name', type: 'string', path: 'name' },
        ],
      }),
      op({
        id: 'get_product',
        path: '/products/{productId}',
        method: 'GET',
        tags: ['products'],
        parameters: [{ name: 'productId', in: 'path', type: 'string', required: true }],
      }),
    ]

    const graph = buildOperationGraph(operations)
    const workflows = inferWorkflows(graph)

    const browse = workflows.find(w => w.pattern === WorkflowPattern.Browse)
    expect(browse).toBeDefined()
    expect(browse!.name).toContain('products')
    expect(browse!.steps).toHaveLength(2)
    expect(browse!.steps[0]!.role).toBe('list')
    expect(browse!.steps[1]!.role).toBe('detail')
  })

  it('detects a CRUD workflow', () => {
    const operations: InferenceOperation[] = [
      op({ id: 'create_user', path: '/users', method: 'POST', tags: ['users'] }),
      op({
        id: 'get_user',
        path: '/users/{userId}',
        method: 'GET',
        tags: ['users'],
        parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }],
        responseFields: [{ name: 'id', type: 'string', path: 'id' }],
      }),
      op({
        id: 'update_user',
        path: '/users/{userId}',
        method: 'PUT',
        tags: ['users'],
        parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }],
      }),
      op({
        id: 'delete_user',
        path: '/users/{userId}',
        method: 'DELETE',
        tags: ['users'],
        parameters: [{ name: 'userId', in: 'path', type: 'string', required: true }],
      }),
    ]

    const graph = buildOperationGraph(operations)
    const workflows = inferWorkflows(graph)

    const crud = workflows.find(w => w.pattern === WorkflowPattern.CRUD)
    expect(crud).toBeDefined()
    expect(crud!.steps.length).toBeGreaterThanOrEqual(3)
    expect(crud!.steps.map(s => s.role)).toContain('create')
    expect(crud!.steps.map(s => s.role)).toContain('read')
  })

  it('returns empty array for unrelated operations', () => {
    const operations: InferenceOperation[] = [
      op({ id: 'get_weather', path: '/weather', method: 'GET', tags: ['weather'] }),
      op({ id: 'get_news', path: '/news', method: 'GET', tags: ['news'] }),
    ]

    const graph = buildOperationGraph(operations)
    const workflows = inferWorkflows(graph)
    expect(workflows).toHaveLength(0)
  })
})
