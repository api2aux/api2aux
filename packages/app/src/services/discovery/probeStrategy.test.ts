import { describe, it, expect } from 'vitest'
import { selectProbes } from './probeStrategy'
import type { InferenceOperation } from '@api2aux/workflow-inference'

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

describe('selectProbes', () => {
  it('prioritizes zero-param GET endpoints', () => {
    const ops: InferenceOperation[] = [
      op({
        id: 'get_detail',
        path: '/items/{id}',
        parameters: [{ name: 'id', in: 'path', type: 'string', required: true }],
      }),
      op({
        id: 'list_items',
        path: '/items',
        responseFields: [{ name: 'id', type: 'string', path: 'id' }],
      }),
      op({
        id: 'create_item',
        path: '/items',
        method: 'POST',
      }),
    ]

    const probes = selectProbes(ops)

    // list_items should be first (zero params, GET, has response fields)
    expect(probes[0]!.operationId).toBe('list_items')
    // create_item should be excluded (POST)
    expect(probes.find(p => p.operationId === 'create_item')).toBeUndefined()
    // get_detail should be excluded (can't fill {id} without enum/example)
    expect(probes.find(p => p.operationId === 'get_detail')).toBeUndefined()
  })

  it('includes endpoints with enum params', () => {
    const ops: InferenceOperation[] = [
      op({
        id: 'get_skill',
        path: '/skills/{index}',
        parameters: [{
          name: 'index',
          in: 'path',
          type: 'string',
          required: true,
          enum: ['acrobatics', 'athletics'],
        }],
      }),
    ]

    const probes = selectProbes(ops)
    expect(probes).toHaveLength(1)
    expect(probes[0]!.args).toEqual({ index: 'acrobatics' })
  })

  it('includes endpoints with example params', () => {
    const ops: InferenceOperation[] = [
      op({
        id: 'get_user',
        path: '/users/{userId}',
        parameters: [{
          name: 'userId',
          in: 'path',
          type: 'string',
          required: true,
          example: 'user-42',
        }],
      }),
    ]

    const probes = selectProbes(ops)
    expect(probes).toHaveLength(1)
    expect(probes[0]!.args).toEqual({ userId: 'user-42' })
  })

  it('respects budget', () => {
    const ops: InferenceOperation[] = Array.from({ length: 20 }, (_, i) =>
      op({ id: `list_${i}`, path: `/resource-${i}` })
    )

    const probes = selectProbes(ops, 5)
    expect(probes).toHaveLength(5)
  })

  it('excludes non-GET methods', () => {
    const ops: InferenceOperation[] = [
      op({ id: 'create', path: '/items', method: 'POST' }),
      op({ id: 'update', path: '/items/{id}', method: 'PUT' }),
      op({ id: 'delete', path: '/items/{id}', method: 'DELETE' }),
    ]

    const probes = selectProbes(ops)
    expect(probes).toHaveLength(0)
  })

  it('diversifies across resource groups via round-robin', () => {
    // Simulate D&D-like API: many sub-endpoints under /classes, but also
    // separate resources like /skills, /monsters, /races
    const ops: InferenceOperation[] = [
      op({ id: 'list_monsters', path: '/api/monsters' }),
      op({ id: 'list_spells', path: '/api/spells' }),
      op({ id: 'list_skills', path: '/api/skills' }),
      op({ id: 'list_races', path: '/api/races' }),
      // Many class sub-endpoints with enums
      op({ id: 'get_class', path: '/api/classes/{index}', parameters: [{ name: 'index', in: 'path', type: 'string', required: true, enum: ['barbarian'] }] }),
      op({ id: 'class_levels', path: '/api/classes/{index}/levels', parameters: [{ name: 'index', in: 'path', type: 'string', required: true, enum: ['barbarian'] }] }),
      op({ id: 'class_multi', path: '/api/classes/{index}/multi-classing', parameters: [{ name: 'index', in: 'path', type: 'string', required: true, enum: ['barbarian'] }] }),
      op({ id: 'class_spellcasting', path: '/api/classes/{index}/spellcasting', parameters: [{ name: 'index', in: 'path', type: 'string', required: true, enum: ['barbarian'] }] }),
      op({ id: 'class_features', path: '/api/classes/{index}/features', parameters: [{ name: 'index', in: 'path', type: 'string', required: true, enum: ['barbarian'] }] }),
    ]

    const probes = selectProbes(ops, 6)
    const ids = probes.map(p => p.operationId)

    // Should include endpoints from multiple resource groups, not just classes
    expect(ids).toContain('list_monsters')
    expect(ids).toContain('list_spells')
    expect(ids).toContain('list_skills')
    expect(ids).toContain('list_races')
    // Classes should get at most 2 slots (not all 5)
    const classProbes = ids.filter(id => id.startsWith('get_class') || id.startsWith('class_'))
    expect(classProbes.length).toBeLessThanOrEqual(2)
  })
})
