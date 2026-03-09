import { describe, it, expect } from 'vitest'
import {
  extractResponseFields, generateToolName, sanitizeToolName, generateDescription,
  parameterToJsonSchema, generateToolDefinition, generateToolDefinitions,
  generateRawUrlToolDefinition, ParameterIn,
} from './index'
import type { ToolParameter, ToolOperationWithParams } from './types'

describe('extractResponseFields', () => {
  it('extracts from object schema', () => {
    expect(extractResponseFields({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
    })).toEqual(['name', 'age'])
  })

  it('extracts from array-of-objects schema', () => {
    expect(extractResponseFields({
      type: 'array',
      items: { type: 'object', properties: { id: {}, title: {} } },
    })).toEqual(['id', 'title'])
  })

  it('extracts from allOf combiner', () => {
    expect(extractResponseFields({
      allOf: [{ type: 'object', properties: { foo: {}, bar: {} } }],
    })).toEqual(['foo', 'bar'])
  })

  it('unwraps list wrapper objects to get entity fields', () => {
    // Common pattern: { count: number, results: [{ index, name, url }] }
    expect(extractResponseFields({
      type: 'object',
      properties: {
        count: { type: 'integer' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: { index: {}, name: {}, url: {} },
          },
        },
      },
    })).toEqual(['index', 'name', 'url'])
  })

  it('does not unwrap objects with many top-level fields', () => {
    // 5+ fields = not a wrapper, return top-level fields as-is
    expect(extractResponseFields({
      type: 'object',
      properties: { a: {}, b: {}, c: {}, d: {}, e: {} },
    })).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns null for empty/invalid schema', () => {
    expect(extractResponseFields(null)).toBeNull()
    expect(extractResponseFields({})).toBeNull()
    expect(extractResponseFields({ type: 'string' })).toBeNull()
  })
})

describe('generateToolName', () => {
  it('converts id to snake_case', () => {
    expect(generateToolName({
      path: '/pets', method: 'get', id: 'listPets', tags: [],
    })).toBe('list_pets')
  })

  it('falls back to method_path when id is empty', () => {
    expect(generateToolName({
      id: '', path: '/users/{id}', method: 'get', tags: [],
    })).toBe('get_users_by_id')
  })
})

describe('sanitizeToolName', () => {
  it('strips invalid characters and truncates', () => {
    expect(sanitizeToolName('GET /api/classes/{index}')).toBe('GET_api_classes_index')
  })
})

describe('generateDescription', () => {
  const op = {
    id: 'getClassByIndex',
    path: '/api/classes/{index}',
    method: 'get',
    summary: 'Get a class by index.',
    tags: ['Class'],
    responseSchema: { type: 'object', properties: { name: {}, hit_die: {} } },
  }

  it('includes summary, tags, and response fields', () => {
    const desc = generateDescription(op)
    expect(desc).toContain('Get a class by index.')
    expect(desc).toContain('Tags: Class')
    expect(desc).toContain('Returns: { name: any, hit_die: any }')
  })

  it('includes path when includePath option is set', () => {
    const desc = generateDescription(op, { includePath: true })
    expect(desc).toContain('GET /api/classes/{index}')
  })

  it('does not include path by default', () => {
    const desc = generateDescription(op)
    expect(desc).not.toContain('GET /api/classes/{index}')
  })
})

describe('parameterToJsonSchema', () => {
  it('converts string parameter', () => {
    const param: ToolParameter = {
      name: 'name', in: ParameterIn.Query, required: true,
      description: 'Filter by name', schema: { type: 'string' },
    }
    const result = parameterToJsonSchema(param)
    expect(result.type).toBe('string')
    expect(result.description).toBe('Filter by name')
  })

  it('converts number parameter with constraints', () => {
    const param: ToolParameter = {
      name: 'limit', in: ParameterIn.Query, required: false,
      description: 'Max results', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    }
    const result = parameterToJsonSchema(param)
    expect(result.type).toBe('number')
    expect(result.minimum).toBe(1)
    expect(result.maximum).toBe(100)
    expect(result.description).toContain('Default: 20')
  })

  it('converts enum parameter', () => {
    const param: ToolParameter = {
      name: 'sort', in: ParameterIn.Query, required: false,
      description: 'Sort order', schema: { type: 'string', enum: ['asc', 'desc'] },
    }
    const result = parameterToJsonSchema(param)
    expect(result.enum).toEqual(['asc', 'desc'])
  })

  it('converts boolean parameter', () => {
    const param: ToolParameter = {
      name: 'active', in: ParameterIn.Query, required: false,
      description: 'Filter active', schema: { type: 'boolean' },
    }
    const result = parameterToJsonSchema(param)
    expect(result.type).toBe('boolean')
  })
})

describe('generateToolDefinition', () => {
  const op: ToolOperationWithParams = {
    path: '/pets/{petId}',
    method: 'get',
    id: 'getPetById',
    summary: 'Get a pet by ID',
    tags: ['Pets'],
    responseSchema: { type: 'object', properties: { name: {}, species: {} } },
    parameters: [
      { name: 'petId', in: ParameterIn.Path, required: true, description: 'Pet ID', schema: { type: 'string' } },
    ],
  }

  it('generates a complete tool definition', () => {
    const def = generateToolDefinition(op)
    expect(def.name).toBe('get_pet_by_id')
    expect(def.description).toContain('Get a pet by ID')
    expect(def.inputSchema.type).toBe('object')
    expect(def.inputSchema.properties.petId.type).toBe('string')
    expect(def.inputSchema.required).toEqual(['petId'])
  })

  it('includes request body when present', () => {
    const opWithBody: ToolOperationWithParams = {
      ...op, method: 'post', id: 'createPet',
      requestBody: { required: true, description: 'Pet data' },
    }
    const def = generateToolDefinition(opWithBody)
    expect(def.inputSchema.properties.body.type).toBe('string')
    expect(def.inputSchema.properties.body.description).toContain('Pet data')
    expect(def.inputSchema.required).toContain('body')
  })

  it('omits required array when no params are required', () => {
    const opOptional: ToolOperationWithParams = {
      ...op,
      parameters: [
        { name: 'limit', in: ParameterIn.Query, required: false, description: 'Limit', schema: { type: 'integer' } },
      ],
    }
    const def = generateToolDefinition(opOptional)
    expect(def.inputSchema.required).toBeUndefined()
  })
})

describe('generateToolDefinitions', () => {
  it('generates definitions for multiple operations', () => {
    const ops: ToolOperationWithParams[] = [
      { id: 'getA', path: '/a', method: 'get', tags: [], parameters: [] },
      { id: 'postB', path: '/b', method: 'post', tags: [], parameters: [] },
    ]
    const defs = generateToolDefinitions(ops)
    expect(defs).toHaveLength(2)
    expect(defs[0].name).toBe('get_a')
    expect(defs[1].name).toBe('post_b')
  })
})

describe('generateRawUrlToolDefinition', () => {
  it('generates a tool for a raw URL', () => {
    const def = generateRawUrlToolDefinition('https://api.example.com/v1/users?page=1', [
      { name: 'page', values: ['1'] },
    ])
    expect(def.name).toBe('query_api')
    expect(def.description).toContain('example.com')
    expect(def.inputSchema.properties.path).toBeDefined()
    expect(def.inputSchema.properties.page.default).toBe('1')
  })
})
