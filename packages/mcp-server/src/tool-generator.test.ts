import { describe, it, expect } from 'vitest'
import { generateTools } from './tool-generator'
import type { Operation } from '@api2aux/api-invoke'
import { HttpMethod, ParamLocation } from '@api2aux/api-invoke'

function makeOperation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'listPets',
    summary: 'List all pets',
    description: 'Returns all pets from the system',
    method: HttpMethod.GET,
    path: '/pets',
    parameters: [],
    tags: ['pets'],
    ...overrides,
  }
}

describe('generateTools', () => {
  it('generates a tool from a simple operation', () => {
    const ops = [makeOperation()]
    const tools = generateTools(ops)

    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('list_pets')
    expect(tools[0]!.description).toContain('pets')
    expect(tools[0]!.operation).toBe(ops[0])
  })

  it('creates input schema for path parameters', () => {
    const ops = [makeOperation({
      id: 'getPet',
      path: '/pets/{petId}',
      parameters: [{
        name: 'petId',
        in: ParamLocation.PATH,
        required: true,
        description: 'The pet ID',
        schema: { type: 'string' },
      }],
    })]

    const tools = generateTools(ops)
    const schema = tools[0]!.inputSchema

    expect(schema['petId']).toBeDefined()
    // Path param should be required (not optional)
    const parsed = schema['petId']!.safeParse(undefined)
    expect(parsed.success).toBe(false)
  })

  it('makes optional parameters optional in schema', () => {
    const ops = [makeOperation({
      parameters: [{
        name: 'limit',
        in: ParamLocation.QUERY,
        required: false,
        description: 'Max items',
        schema: { type: 'number' },
      }],
    })]

    const tools = generateTools(ops)
    const schema = tools[0]!.inputSchema

    expect(schema['limit']).toBeDefined()
    const parsed = schema['limit']!.safeParse(undefined)
    expect(parsed.success).toBe(true)
  })

  it('handles number schema with min/max constraints', () => {
    const ops = [makeOperation({
      parameters: [{
        name: 'limit',
        in: ParamLocation.QUERY,
        required: true,
        description: 'Max items',
        schema: { type: 'number', minimum: 1, maximum: 100 },
      }],
    })]

    const tools = generateTools(ops)
    const schema = tools[0]!.inputSchema['limit']!

    expect(schema.safeParse(50).success).toBe(true)
    expect(schema.safeParse(0).success).toBe(false)
    expect(schema.safeParse(101).success).toBe(false)
  })

  it('handles boolean parameters', () => {
    const ops = [makeOperation({
      parameters: [{
        name: 'active',
        in: ParamLocation.QUERY,
        required: false,
        description: 'Filter active',
        schema: { type: 'boolean' },
      }],
    })]

    const tools = generateTools(ops)
    const schema = tools[0]!.inputSchema['active']!

    expect(schema.safeParse(true).success).toBe(true)
    expect(schema.safeParse('yes').success).toBe(false)
  })

  it('generates multiple tools from multiple operations', () => {
    const ops = [
      makeOperation({ id: 'listPets', path: '/pets' }),
      makeOperation({ id: 'createPet', path: '/pets', method: HttpMethod.POST }),
      makeOperation({ id: 'deletePet', path: '/pets/{id}', method: HttpMethod.DELETE }),
    ]

    const tools = generateTools(ops)
    expect(tools).toHaveLength(3)
    expect(tools.map(t => t.name)).toEqual(['list_pets', 'create_pet', 'delete_pet'])
  })

  it('returns empty array for empty operations', () => {
    expect(generateTools([])).toEqual([])
  })
})
