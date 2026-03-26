import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildOperationGraph } from './graph'
import { signalRegistry } from './signals/registry'
import { BuiltInSignal } from './types'
import type { InferenceOperation, SignalRegistration } from './types'

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
      signals: [{ signal: BuiltInSignal.RuntimeValueMatch, weight: 0.40, matched: true, detail: 'ability_score.index → index (0.80)' }],
    }]

    const graph = buildOperationGraph(operations, undefined, runtimeEdges)

    const edge = graph.edges.find(e => e.sourceId === 'get_skill' && e.targetId === 'get_ability_score')
    expect(edge).toBeDefined()
    expect(edge!.signals.some(s => s.signal === BuiltInSignal.RuntimeValueMatch)).toBe(true)
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

// ============================================================================
// Signal Registry
// ============================================================================
describe('SignalRegistry', () => {
  afterEach(() => {
    signalRegistry.reset()
  })

  it('has 5 built-in signals registered', () => {
    expect(signalRegistry.size).toBe(5)
    expect(signalRegistry.get(BuiltInSignal.IdPattern)).toBeDefined()
    expect(signalRegistry.get(BuiltInSignal.RestConventions)).toBeDefined()
    expect(signalRegistry.get(BuiltInSignal.SchemaCompat)).toBeDefined()
    expect(signalRegistry.get(BuiltInSignal.TagProximity)).toBeDefined()
    expect(signalRegistry.get(BuiltInSignal.NameSimilarity)).toBeDefined()
  })

  it('stores weight metadata on built-in signals', () => {
    expect(signalRegistry.get(BuiltInSignal.IdPattern)?.weight).toBe(0.35)
    expect(signalRegistry.get(BuiltInSignal.RestConventions)?.weight).toBe(0.25)
    expect(signalRegistry.get(BuiltInSignal.SchemaCompat)?.weight).toBe(0.25)
    expect(signalRegistry.get(BuiltInSignal.TagProximity)?.weight).toBe(0.10)
    expect(signalRegistry.get(BuiltInSignal.NameSimilarity)?.weight).toBe(0.05)
  })

  it('clearCustom removes custom signals but preserves built-ins', () => {
    signalRegistry.register({ id: 'custom-a', signal: () => [] })
    signalRegistry.register({ id: 'custom-b', signal: () => [] })
    expect(signalRegistry.size).toBe(7)

    signalRegistry.clearCustom()

    expect(signalRegistry.size).toBe(5)
    expect(signalRegistry.get('custom-a')).toBeUndefined()
    expect(signalRegistry.get('custom-b')).toBeUndefined()
    expect(signalRegistry.get(BuiltInSignal.IdPattern)).toBeDefined()
    expect(signalRegistry.get(BuiltInSignal.RestConventions)).toBeDefined()
  })

  it('clearCustom works correctly after reset', () => {
    signalRegistry.register({ id: 'custom-x', signal: () => [] })
    signalRegistry.reset()
    signalRegistry.register({ id: 'custom-y', signal: () => [] })
    expect(signalRegistry.size).toBe(6)

    signalRegistry.clearCustom()

    expect(signalRegistry.size).toBe(5)
    expect(signalRegistry.get('custom-y')).toBeUndefined()
  })

  it('reset restores exactly 5 built-in signals after clear', () => {
    signalRegistry.register({ id: 'custom-z', signal: () => [] })
    signalRegistry.reset()

    expect(signalRegistry.size).toBe(5)
    expect(signalRegistry.get(BuiltInSignal.IdPattern)).toBeDefined()
    expect(signalRegistry.get(BuiltInSignal.NameSimilarity)).toBeDefined()
    expect(signalRegistry.get('custom-z')).toBeUndefined()
  })

  it('unregister returns true for existing custom signal', () => {
    signalRegistry.register({ id: 'to-remove', signal: () => [] })
    expect(signalRegistry.unregister('to-remove')).toBe(true)
    expect(signalRegistry.get('to-remove')).toBeUndefined()
  })

  it('unregister throws for unknown signal by default', () => {
    expect(() => signalRegistry.unregister('nonexistent')).toThrow(/Cannot unregister unknown/)
  })

  it('unregister returns false for unknown signal with ignoreUnknown', () => {
    expect(signalRegistry.unregister('nonexistent', { ignoreUnknown: true })).toBe(false)
  })

  it('unregister throws for built-in signal without force', () => {
    expect(() => signalRegistry.unregister(BuiltInSignal.IdPattern)).toThrow(/built-in signal/)
  })

  it('unregister allows removing built-in signal with force', () => {
    expect(signalRegistry.unregister(BuiltInSignal.IdPattern, { force: true })).toBe(true)
    expect(signalRegistry.size).toBe(4)
    expect(signalRegistry.get(BuiltInSignal.IdPattern)).toBeUndefined()
  })

  it('register throws for empty ID', () => {
    expect(() => signalRegistry.register({ id: '', signal: () => [] })).toThrow(/non-empty string/)
  })

  it('register throws for whitespace-only ID', () => {
    expect(() => signalRegistry.register({ id: '  ', signal: () => [] })).toThrow(/non-empty string/)
  })

  it('register throws when signal is not a function', () => {
    expect(() => signalRegistry.register({ id: 'bad', signal: null as any })).toThrow(/must have a signal function/)
  })
})

describe('buildOperationGraph with custom signals', () => {
  afterEach(() => {
    signalRegistry.reset()
  })

  it('uses custom signal passed via options.signals', () => {
    const operations: InferenceOperation[] = [
      op({ id: 'op_a', path: '/a', tags: ['test'] }),
      op({ id: 'op_b', path: '/b', tags: ['test'] }),
    ]

    const customSignal: SignalRegistration = {
      id: 'custom-test',
      signal: () => [{
        sourceId: 'op_a',
        targetId: 'op_b',
        bindings: [],
        score: 0.5,
        signals: [{ signal: 'custom-test', weight: 1.0, matched: true, detail: 'test edge' }],
      }],
    }

    const graph = buildOperationGraph(operations, undefined, undefined, [customSignal])
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].sourceId).toBe('op_a')
    expect(graph.edges[0].targetId).toBe('op_b')
    expect(graph.edges[0].signals.some(s => s.signal === 'custom-test')).toBe(true)
  })

  it('options.signals overrides registry — registry signals not used', () => {
    const operations: InferenceOperation[] = [
      op({
        id: 'list_users',
        path: '/users',
        tags: ['users'],
        responseFields: [{ name: 'id', type: 'string', format: 'uuid', path: 'id' }],
      }),
      op({
        id: 'get_user',
        path: '/users/{userId}',
        tags: ['users'],
        parameters: [{ name: 'userId', in: 'path', type: 'string', format: 'uuid', required: true }],
      }),
    ]

    // Empty signals array → no signals run → no edges
    const graph = buildOperationGraph(operations, undefined, undefined, [])
    expect(graph.edges).toHaveLength(0)
  })

  it('registered custom signal contributes to graph', () => {
    const operations: InferenceOperation[] = [
      op({ id: 'op_x', path: '/x', tags: ['test'] }),
      op({ id: 'op_y', path: '/y', tags: ['test'] }),
    ]

    const customSignal: SignalRegistration = {
      id: 'custom-registered',
      signal: () => [{
        sourceId: 'op_x',
        targetId: 'op_y',
        bindings: [],
        score: 0.8,
        signals: [{ signal: 'custom-registered', weight: 1.0, matched: true }],
      }],
    }

    signalRegistry.register(customSignal)
    const graph = buildOperationGraph(operations)
    const edge = graph.edges.find(e => e.sourceId === 'op_x' && e.targetId === 'op_y')
    expect(edge).toBeDefined()
  })

  it('unregistered custom signal no longer contributes', () => {
    // Use isolated operations with no shared tags/paths to avoid built-in signal edges
    const operations: InferenceOperation[] = [
      op({ id: 'op_x', path: '/alpha', tags: ['groupA'] }),
      op({ id: 'op_y', path: '/beta', tags: ['groupB'] }),
    ]

    const customSignal: SignalRegistration = {
      id: 'temp-signal',
      signal: () => [{
        sourceId: 'op_x',
        targetId: 'op_y',
        bindings: [],
        score: 0.8,
        signals: [{ signal: 'temp-signal', weight: 1.0, matched: true }],
      }],
    }

    signalRegistry.register(customSignal)
    signalRegistry.unregister('temp-signal')

    const graph = buildOperationGraph(operations)
    const edge = graph.edges.find(e => e.sourceId === 'op_x' && e.targetId === 'op_y')
    expect(edge).toBeUndefined()
  })

  it('duplicate registration throws without override flag', () => {
    const signal1: SignalRegistration = {
      id: 'dup-signal',
      signal: () => [],
    }
    const signal2: SignalRegistration = {
      id: 'dup-signal',
      signal: () => [],
    }

    signalRegistry.register(signal1)
    expect(() => signalRegistry.register(signal2)).toThrow(/already registered/)
    expect(() => signalRegistry.register(signal2, { override: true })).not.toThrow()
  })

  it('surfaces signal errors in graph result', () => {
    const operations: InferenceOperation[] = [
      op({ id: 'op_a', path: '/a', tags: ['test'] }),
      op({ id: 'op_b', path: '/b', tags: ['test'] }),
    ]

    const failingSignal: SignalRegistration = {
      id: 'failing-signal',
      signal: () => { throw new Error('boom') },
    }

    const graph = buildOperationGraph(operations, undefined, undefined, [failingSignal])
    expect(graph.signalErrors).toHaveLength(1)
    expect(graph.signalErrors![0].id).toBe('failing-signal')
    expect(graph.signalErrors![0].message).toBe('boom')
  })
})
