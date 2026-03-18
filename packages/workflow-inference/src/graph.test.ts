import { describe, it, expect } from 'vitest'
import { buildOperationGraph } from './graph'
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

describe('buildOperationGraph', () => {
  it('builds a graph with edges for a CRUD API', () => {
    const operations: InferenceOperation[] = [
      op({
        id: 'list_users',
        path: '/users',
        method: 'GET',
        tags: ['users'],
        responseFields: [
          { name: 'id', type: 'string', format: 'uuid', path: 'id' },
          { name: 'name', type: 'string', path: 'name' },
          { name: 'email', type: 'string', format: 'email', path: 'email' },
        ],
      }),
      op({
        id: 'get_user',
        path: '/users/{userId}',
        method: 'GET',
        tags: ['users'],
        parameters: [{ name: 'userId', in: 'path', type: 'string', format: 'uuid', required: true }],
        responseFields: [
          { name: 'id', type: 'string', format: 'uuid', path: 'id' },
          { name: 'name', type: 'string', path: 'name' },
        ],
      }),
      op({
        id: 'create_user',
        path: '/users',
        method: 'POST',
        tags: ['users'],
        requestBodyFields: [
          { name: 'name', type: 'string', path: 'name' },
          { name: 'email', type: 'string', path: 'email' },
        ],
      }),
      op({
        id: 'update_user',
        path: '/users/{userId}',
        method: 'PUT',
        tags: ['users'],
        parameters: [{ name: 'userId', in: 'path', type: 'string', format: 'uuid', required: true }],
      }),
      op({
        id: 'delete_user',
        path: '/users/{userId}',
        method: 'DELETE',
        tags: ['users'],
        parameters: [{ name: 'userId', in: 'path', type: 'string', format: 'uuid', required: true }],
      }),
    ]

    const graph = buildOperationGraph(operations)

    expect(graph.nodes).toHaveLength(5)
    expect(graph.edges.length).toBeGreaterThan(0)

    // list_users → get_user should have a strong edge
    const listToDetail = graph.edges.find(e => e.sourceId === 'list_users' && e.targetId === 'get_user')
    expect(listToDetail).toBeDefined()
    expect(listToDetail!.score).toBeGreaterThan(0.2)

    // create_user → get_user should have an edge (create then get)
    const createToDetail = graph.edges.find(e => e.sourceId === 'create_user' && e.targetId === 'get_user')
    expect(createToDetail).toBeDefined()
  })

  it('includes pre-computed runtime edges in the graph', () => {
    const operations: InferenceOperation[] = [
      op({
        id: 'get_skill',
        path: '/skills/{index}',
        tags: ['skills'],
        parameters: [{ name: 'index', in: 'path', type: 'string', required: true }],
      }),
      op({
        id: 'get_ability_score',
        path: '/ability-scores/{index}',
        tags: ['ability-scores'],
        parameters: [{ name: 'index', in: 'path', type: 'string', required: true }],
      }),
    ]

    const runtimeEdges = [{
      sourceId: 'get_skill',
      targetId: 'get_ability_score',
      bindings: [{ sourceField: 'ability_score.index', targetParam: 'index', targetParamIn: 'path', confidence: 0.80 }],
      score: 0.32,
      signals: [{ signal: 'runtime-value-match' as const, weight: 0.40, matched: true, detail: 'ability_score.index → index (0.80)' }],
    }]

    const graph = buildOperationGraph(operations, undefined, runtimeEdges)

    const edge = graph.edges.find(e => e.sourceId === 'get_skill' && e.targetId === 'get_ability_score')
    expect(edge).toBeDefined()
    expect(edge!.signals.some(s => s.signal === 'runtime-value-match')).toBe(true)
  })

  it('filters out low-score edges', () => {
    const operations: InferenceOperation[] = [
      op({
        id: 'op_a',
        path: '/a',
        tags: ['x'],
        responseFields: [{ name: 'foo', type: 'string', path: 'foo' }],
      }),
      op({
        id: 'op_b',
        path: '/b',
        tags: ['y'],
        parameters: [{ name: 'bar', in: 'query', type: 'string', required: false }],
      }),
    ]

    const graph = buildOperationGraph(operations)
    // These operations have no meaningful relationship — edges should be filtered
    expect(graph.edges.length).toBe(0)
  })
})
