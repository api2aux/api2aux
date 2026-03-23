import { describe, it, expect } from 'vitest'
import { buildUrl, deriveBaseUrl, extractCookieParams } from './url-builder'
import type { Operation } from './types'
import { HttpMethod, ParamLocation } from './types'
import { parseRawUrl } from '../adapters/raw/parser'

describe('buildUrl', () => {
  const baseOp: Operation = {
    id: 'test',
    path: '/users/{id}',
    method: HttpMethod.GET,
    parameters: [
      { name: 'id', in: ParamLocation.PATH, required: true, description: '', schema: { type: 'string' } },
      { name: 'limit', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'number' } },
    ],
    tags: [],
  }

  it('interpolates path parameters', () => {
    const url = buildUrl('https://api.example.com', baseOp, { id: '42' })
    expect(url).toBe('https://api.example.com/users/42')
  })

  it('appends query parameters', () => {
    const url = buildUrl('https://api.example.com', baseOp, { id: '42', limit: 10 })
    expect(url).toBe('https://api.example.com/users/42?limit=10')
  })

  it('encodes path parameters', () => {
    const url = buildUrl('https://api.example.com', baseOp, { id: 'hello world' })
    expect(url).toBe('https://api.example.com/users/hello%20world')
  })

  it('handles trailing slash on baseUrl', () => {
    const url = buildUrl('https://api.example.com/', baseOp, { id: '42' })
    expect(url).toBe('https://api.example.com/users/42')
  })

  it('preserves baseUrl path prefix', () => {
    const url = buildUrl('https://api.example.com/v1', baseOp, { id: '42' })
    expect(url).toBe('https://api.example.com/v1/users/42')
  })

  it('does not append trailing slash when path is empty (executeRaw case)', () => {
    const op: Operation = {
      id: 'raw',
      path: '',
      method: HttpMethod.GET,
      parameters: [],
      tags: [],
    }
    const url = buildUrl('https://example.com/api/endpoint?foo=bar', op, {})
    expect(url).toBe('https://example.com/api/endpoint?foo=bar')
  })

  it('does not append trailing slash when path is empty (no query params)', () => {
    const op: Operation = {
      id: 'raw',
      path: '',
      method: HttpMethod.GET,
      parameters: [],
      tags: [],
    }
    const url = buildUrl('https://example.com/api/endpoint', op, {})
    expect(url).toBe('https://example.com/api/endpoint')
  })
})

describe('default parameter values', () => {
  it('applies default when arg is not provided', () => {
    const op: Operation = {
      id: 'test',
      path: '/items',
      method: HttpMethod.GET,
      parameters: [
        { name: 'format', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'string', default: 'json' } },
      ],
      tags: [],
    }
    const url = buildUrl('https://api.example.com', op, {})
    expect(url).toBe('https://api.example.com/items?format=json')
  })

  it('allows overriding default', () => {
    const op: Operation = {
      id: 'test',
      path: '/items',
      method: HttpMethod.GET,
      parameters: [
        { name: 'format', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'string', default: 'json' } },
      ],
      tags: [],
    }
    const url = buildUrl('https://api.example.com', op, { format: 'xml' })
    expect(url).toBe('https://api.example.com/items?format=xml')
  })
})

describe('array/object query param serialization', () => {
  it('serializes arrays as comma-separated', () => {
    const op: Operation = {
      id: 'test',
      path: '/items',
      method: HttpMethod.GET,
      parameters: [
        { name: 'tags', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'array' } },
      ],
      tags: [],
    }
    const url = buildUrl('https://api.example.com', op, { tags: ['a', 'b', 'c'] })
    expect(url).toContain('tags=a%2Cb%2Cc')
  })

  it('serializes objects as comma-separated key,value pairs', () => {
    const op: Operation = {
      id: 'test',
      path: '/items',
      method: HttpMethod.GET,
      parameters: [
        { name: 'filter', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'object' } },
      ],
      tags: [],
    }
    const url = buildUrl('https://api.example.com', op, { filter: { status: 'active', role: 'admin' } })
    expect(url).toContain('filter=status%2Cactive%2Crole%2Cadmin')
  })

  it('throws for nested objects', () => {
    const op: Operation = {
      id: 'test',
      path: '/items',
      method: HttpMethod.GET,
      parameters: [
        { name: 'filter', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'object' } },
      ],
      tags: [],
    }
    expect(() => buildUrl('https://api.example.com', op, { filter: { status: { eq: 'active' } } }))
      .toThrow('Cannot serialize nested object')
  })

  it('serializes empty array as empty value', () => {
    const op: Operation = {
      id: 'test',
      path: '/items',
      method: HttpMethod.GET,
      parameters: [
        { name: 'tags', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'array' } },
      ],
      tags: [],
    }
    const url = buildUrl('https://api.example.com', op, { tags: [] })
    expect(url).toContain('tags=')
  })

  it('handles plain string values normally', () => {
    const op: Operation = {
      id: 'test',
      path: '/items',
      method: HttpMethod.GET,
      parameters: [
        { name: 'q', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'string' } },
      ],
      tags: [],
    }
    const url = buildUrl('https://api.example.com', op, { q: 'hello' })
    expect(url).toBe('https://api.example.com/items?q=hello')
  })

  it('serializes array defaults from raw parser as comma-separated', () => {
    const op: Operation = {
      id: 'test',
      path: '/search',
      method: HttpMethod.GET,
      parameters: [
        { name: 'tags', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'array', default: ['a', 'b', 'c'], items: { type: 'string' } } },
      ],
      tags: [],
    }
    const url = buildUrl('https://api.example.com', op, {})
    expect(url).toContain('tags=a%2Cb%2Cc')
  })

  it('round-trips repeated keys as comma-separated (lossy)', () => {
    const api = parseRawUrl('https://example.com/search?tags=a&tags=b')
    const url = buildUrl(api.baseUrl, api.operations[0], {})
    expect(url).toContain('tags=a%2Cb')
  })
})

describe('deriveBaseUrl', () => {
  it('strips filename from spec URL', () => {
    expect(deriveBaseUrl('https://alphafold.ebi.ac.uk/api/openapi.json'))
      .toBe('https://alphafold.ebi.ac.uk/api')
  })

  it('handles root-level spec', () => {
    expect(deriveBaseUrl('https://api.example.com/openapi.json'))
      .toBe('https://api.example.com')
  })

  it('returns empty for invalid URL', () => {
    expect(deriveBaseUrl('not-a-url')).toBe('')
  })
})

describe('extractCookieParams', () => {
  it('extracts cookie parameters', () => {
    const params = [
      { name: 'session', in: ParamLocation.COOKIE, required: false, description: '', schema: { type: 'string' } },
      { name: 'q', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'string' } },
    ]
    expect(extractCookieParams(params, { session: 'abc123' })).toBe('session=abc123')
  })

  it('joins multiple cookies with semicolon', () => {
    const params = [
      { name: 'session', in: ParamLocation.COOKIE, required: false, description: '', schema: { type: 'string' } },
      { name: 'theme', in: ParamLocation.COOKIE, required: false, description: '', schema: { type: 'string' } },
    ]
    expect(extractCookieParams(params, { session: 'abc', theme: 'dark' })).toBe('session=abc; theme=dark')
  })

  it('returns undefined when no cookie params', () => {
    const params = [
      { name: 'q', in: ParamLocation.QUERY, required: false, description: '', schema: { type: 'string' } },
    ]
    expect(extractCookieParams(params, { q: 'test' })).toBeUndefined()
  })

  it('encodes special characters in cookie values', () => {
    const params = [
      { name: 'data', in: ParamLocation.COOKIE, required: false, description: '', schema: { type: 'string' } },
    ]
    expect(extractCookieParams(params, { data: 'val=ue;stuff' })).toBe('data=val%3Due%3Bstuff')
  })

  it('uses default values for cookie params', () => {
    const params = [
      { name: 'lang', in: ParamLocation.COOKIE, required: false, description: '', schema: { type: 'string', default: 'en' } },
    ]
    expect(extractCookieParams(params, {})).toBe('lang=en')
  })
})
