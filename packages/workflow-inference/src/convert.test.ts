import { describe, it, expect } from 'vitest'
import { operationsToInference, extractFieldsFromSchema } from './convert'

describe('operationsToInference', () => {
  it('converts a basic operation', () => {
    const result = operationsToInference([{
      id: 'list_users',
      path: '/users',
      method: 'get',
      tags: ['users'],
      parameters: [
        { name: 'page', in: 'query', required: false, schema: { type: 'integer' } },
      ],
      responseSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      },
    }])

    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('list_users')
    expect(result[0]!.method).toBe('GET')
    expect(result[0]!.parameters).toHaveLength(1)
    expect(result[0]!.responseFields).toHaveLength(2)
    expect(result[0]!.responseFields.map(f => f.name)).toEqual(['id', 'name'])
  })
  it('filters enum to only string/number and passes through valid examples', () => {
    const result = operationsToInference([{
      id: 'get_item',
      path: '/items/{id}',
      method: 'get',
      tags: [],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: {
            type: 'string',
            enum: ['active', 42, true, null, { nested: true }, 'inactive'],
            example: 'active',
          },
        },
      ],
    }])

    const param = result[0]!.parameters[0]!
    // Only string and number values survive
    expect(param.enum).toEqual(['active', 42, 'inactive'])
    expect(param.example).toBe('active')
  })

  it('drops non-string/number example values', () => {
    const result = operationsToInference([{
      id: 'get_item',
      path: '/items/{id}',
      method: 'get',
      tags: [],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', example: { nested: true } },
        },
      ],
    }])

    const param = result[0]!.parameters[0]!
    expect(param.example).toBeUndefined()
  })
})

describe('extractFieldsFromSchema', () => {
  it('extracts fields from a simple object schema', () => {
    const fields = extractFieldsFromSchema({
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    })
    expect(fields).toHaveLength(2)
  })

  it('extracts fields from an array of objects', () => {
    const fields = extractFieldsFromSchema({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
        },
      },
    })
    expect(fields).toHaveLength(2)
  })

  it('unwraps list wrappers', () => {
    const fields = extractFieldsFromSchema({
      type: 'object',
      properties: {
        count: { type: 'integer' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      },
    })
    expect(fields).toHaveLength(2)
    expect(fields.map(f => f.name)).toEqual(['id', 'name'])
  })

  it('returns empty for null/undefined schema', () => {
    expect(extractFieldsFromSchema(null)).toEqual([])
    expect(extractFieldsFromSchema(undefined)).toEqual([])
  })
})
