import { describe, it, expect } from 'vitest'
import { parseRawUrl, parseRawUrls } from './parser'
import { HttpMethod } from '../../core/types'

describe('parseRawUrl', () => {
  it('creates a single operation from a URL', () => {
    const api = parseRawUrl('https://api.example.com/users')
    expect(api.operations).toHaveLength(1)
    expect(api.operations[0].method).toBe(HttpMethod.GET)
    expect(api.operations[0].path).toBe('/users')
  })

  it('extracts query params as parameters with defaults', () => {
    const api = parseRawUrl('https://api.example.com/users?page=1&limit=10')
    const params = api.operations[0].parameters
    expect(params).toHaveLength(2)
    expect(params[0].name).toBe('page')
    expect(params[0].schema.type).toBe('string')
    expect(params[0].schema.default).toBe('1')
    expect(params[0].schema.items).toBeUndefined()
    expect(params[1].name).toBe('limit')
    expect(params[1].schema.default).toBe('10')
  })

  it('merges repeated query parameters into array', () => {
    const api = parseRawUrl('https://example.com/search?tags=a&tags=b&tags=c')
    const op = api.operations[0]
    const tagsParam = op.parameters.find(p => p.name === 'tags')
    expect(tagsParam).toBeDefined()
    expect(tagsParam!.schema.type).toBe('array')
    expect(tagsParam!.schema.default).toEqual(['a', 'b', 'c'])
    expect(tagsParam!.schema.items).toEqual({ type: 'string' })
  })

  it('strips bracket notation and creates array parameter', () => {
    const api = parseRawUrl('https://example.com/search?ids[]=1&ids[]=2')
    const op = api.operations[0]
    const idsParam = op.parameters.find(p => p.name === 'ids')
    expect(idsParam).toBeDefined()
    expect(idsParam!.schema.type).toBe('array')
    expect(idsParam!.schema.default).toEqual(['1', '2'])
    expect(idsParam!.schema.items).toEqual({ type: 'string' })
    expect(op.parameters.find(p => p.name === 'ids[]')).toBeUndefined()
  })

  it('treats single bracket notation as array', () => {
    const api = parseRawUrl('https://example.com/search?tag[]=solo')
    const op = api.operations[0]
    const tagParam = op.parameters.find(p => p.name === 'tag')
    expect(tagParam!.schema.type).toBe('array')
    expect(tagParam!.schema.default).toEqual(['solo'])
    expect(tagParam!.schema.items).toEqual({ type: 'string' })
  })

  it('handles mixed repeated and single params', () => {
    const api = parseRawUrl('https://example.com?tags=a&tags=b&limit=10')
    const op = api.operations[0]
    expect(op.parameters).toHaveLength(2)
    const tags = op.parameters.find(p => p.name === 'tags')!
    const limit = op.parameters.find(p => p.name === 'limit')!
    expect(tags.schema.type).toBe('array')
    expect(limit.schema.type).toBe('string')
  })

  it('skips bare bracket keys', () => {
    const api = parseRawUrl('https://example.com/search?[]=1&[]=2&name=ok')
    const op = api.operations[0]
    expect(op.parameters).toHaveLength(1)
    expect(op.parameters[0].name).toBe('name')
  })

  it('merges mixed bracket and non-bracket forms', () => {
    const api = parseRawUrl('https://example.com/search?tags=a&tags[]=b')
    const op = api.operations[0]
    expect(op.parameters).toHaveLength(1)
    const tags = op.parameters[0]
    expect(tags.name).toBe('tags')
    expect(tags.schema.type).toBe('array')
    expect(tags.schema.default).toEqual(['a', 'b'])
  })

  it('strips nested bracket notation', () => {
    const api = parseRawUrl('https://example.com/search?matrix[][]=1&matrix[][]=2')
    const op = api.operations[0]
    const param = op.parameters.find(p => p.name === 'matrix')
    expect(param).toBeDefined()
    expect(param!.schema.type).toBe('array')
    expect(op.parameters.find(p => p.name === 'matrix[]')).toBeUndefined()
    expect(op.parameters.find(p => p.name === 'matrix[][]')).toBeUndefined()
  })

  it('preserves URL-decoded values in array defaults', () => {
    const api = parseRawUrl('https://example.com/search?tags=hello%20world&tags=foo%26bar')
    const tags = api.operations[0].parameters.find(p => p.name === 'tags')!
    expect(tags.schema.default).toEqual(['hello world', 'foo&bar'])
  })

  it('preserves empty string values in arrays', () => {
    const api = parseRawUrl('https://example.com/search?tags=&tags=b')
    const tags = api.operations[0].parameters.find(p => p.name === 'tags')!
    expect(tags.schema.default).toEqual(['', 'b'])
  })

  it('formats array description as comma-separated defaults', () => {
    const api = parseRawUrl('https://example.com/search?tags=a&tags=b&tags=c')
    const tags = api.operations[0].parameters.find(p => p.name === 'tags')!
    expect(tags.description).toBe('Default: ["a","b","c"]')
  })

  it('uses hostname as title', () => {
    const api = parseRawUrl('https://api.example.com/data')
    expect(api.title).toBe('api.example.com')
  })
})

describe('parseRawUrls', () => {
  it('creates multiple operations from multiple URLs', () => {
    const api = parseRawUrls([
      { url: 'https://api.example.com/users', method: HttpMethod.GET },
      { url: 'https://api.example.com/users', method: HttpMethod.POST },
      { url: 'https://api.example.com/users/123', method: HttpMethod.DELETE },
    ])
    expect(api.operations).toHaveLength(3)
    expect(api.operations[0].method).toBe(HttpMethod.GET)
    expect(api.operations[1].method).toBe(HttpMethod.POST)
    expect(api.operations[2].method).toBe(HttpMethod.DELETE)
  })

  it('derives baseUrl from first endpoint origin', () => {
    const api = parseRawUrls([
      { url: 'https://api.example.com/v1/users' },
    ])
    expect(api.baseUrl).toBe('https://api.example.com')
  })

  it('uses custom id and summary', () => {
    const api = parseRawUrls([
      { url: 'https://api.example.com/users', id: 'listUsers', summary: 'Get all users' },
    ])
    expect(api.operations[0].id).toBe('listUsers')
    expect(api.operations[0].summary).toBe('Get all users')
  })

  it('generates ids from method and path', () => {
    const api = parseRawUrls([
      { url: 'https://api.example.com/users', method: HttpMethod.POST },
    ])
    expect(api.operations[0].id).toBe('post_users')
  })

  it('throws for empty endpoints array', () => {
    expect(() => parseRawUrls([])).toThrow('At least one endpoint')
  })

  it('defaults method to GET', () => {
    const api = parseRawUrls([
      { url: 'https://api.example.com/data' },
    ])
    expect(api.operations[0].method).toBe(HttpMethod.GET)
  })

  it('throws for mixed origins', () => {
    expect(() => parseRawUrls([
      { url: 'https://api.example.com/users' },
      { url: 'https://other-api.com/data' },
    ])).toThrow('same origin')
  })

  it('throws for invalid URLs with a helpful message', () => {
    expect(() => parseRawUrls([
      { url: 'not-a-url' },
    ])).toThrow('Invalid URL')
  })

  it('throws for invalid URL in non-first endpoint', () => {
    expect(() => parseRawUrls([
      { url: 'https://api.example.com/users' },
      { url: 'not-a-url' },
    ])).toThrow('Invalid URL')
  })
})
