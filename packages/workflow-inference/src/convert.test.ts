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
