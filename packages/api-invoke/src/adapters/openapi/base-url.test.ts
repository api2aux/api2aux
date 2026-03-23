import { describe, it, expect } from 'vitest'
import { extractOpenAPI3BaseUrl, extractSwagger2BaseUrl } from './base-url'
import type { OpenAPIV3, OpenAPIV2 } from 'openapi-types'

describe('extractOpenAPI3BaseUrl', () => {
  it('returns server URL', () => {
    const api = { servers: [{ url: 'https://api.example.com/v1' }] } as OpenAPIV3.Document
    expect(extractOpenAPI3BaseUrl(api)).toBe('https://api.example.com/v1')
  })

  it('returns empty for missing servers', () => {
    const api = {} as OpenAPIV3.Document
    expect(extractOpenAPI3BaseUrl(api)).toBe('')
  })

  it('returns empty for relative URLs without specUrl', () => {
    const api = { servers: [{ url: '/api/v1' }] } as OpenAPIV3.Document
    expect(extractOpenAPI3BaseUrl(api)).toBe('')
  })

  it('resolves relative "/" against specUrl', () => {
    const api = { servers: [{ url: '/' }] } as OpenAPIV3.Document
    expect(extractOpenAPI3BaseUrl(api, 'http://localhost:8788/api/openapi.json')).toBe('http://localhost:8788')
  })

  it('resolves relative "/api/v1" against specUrl', () => {
    const api = { servers: [{ url: '/api/v1' }] } as OpenAPIV3.Document
    expect(extractOpenAPI3BaseUrl(api, 'https://example.com/docs/openapi.json')).toBe('https://example.com/api/v1')
  })

  it('resolves relative path without leading slash against specUrl', () => {
    const api = { servers: [{ url: 'v2' }] } as OpenAPIV3.Document
    expect(extractOpenAPI3BaseUrl(api, 'https://example.com/api/openapi.json')).toBe('https://example.com/api/v2')
  })

  it('interpolates server variables with defaults', () => {
    const api = {
      servers: [{
        url: 'https://{region}.api.example.com/{version}',
        variables: {
          region: { default: 'us-east-1' },
          version: { default: 'v2' },
        },
      }],
    } as unknown as OpenAPIV3.Document
    expect(extractOpenAPI3BaseUrl(api)).toBe('https://us-east-1.api.example.com/v2')
  })

  it('uses first enum value when no default', () => {
    const api = {
      servers: [{
        url: 'https://{env}.example.com',
        variables: {
          env: { enum: ['staging', 'production'] },
        },
      }],
    } as unknown as OpenAPIV3.Document
    expect(extractOpenAPI3BaseUrl(api)).toBe('https://staging.example.com')
  })

  it('returns empty when variable has no default and no enum', () => {
    const api = {
      servers: [{
        url: 'https://{region}.example.com',
        variables: {
          region: {},
        },
      }],
    } as unknown as OpenAPIV3.Document
    expect(extractOpenAPI3BaseUrl(api)).toBe('')
  })

  it('replaces all occurrences of the same variable', () => {
    const api = {
      servers: [{
        url: 'https://{region}.example.com/{region}/api',
        variables: {
          region: { default: 'us' },
        },
      }],
    } as unknown as OpenAPIV3.Document
    expect(extractOpenAPI3BaseUrl(api)).toBe('https://us.example.com/us/api')
  })
})

describe('extractSwagger2BaseUrl', () => {
  it('constructs URL from host and basePath', () => {
    const api = { host: 'api.example.com', basePath: '/v1', schemes: ['https'] } as OpenAPIV2.Document
    expect(extractSwagger2BaseUrl(api)).toBe('https://api.example.com/v1')
  })

  it('returns empty for missing host without specUrl', () => {
    const api = {} as OpenAPIV2.Document
    expect(extractSwagger2BaseUrl(api)).toBe('')
  })

  it('defaults scheme to https', () => {
    const api = { host: 'api.example.com' } as OpenAPIV2.Document
    expect(extractSwagger2BaseUrl(api)).toBe('https://api.example.com')
  })

  it('falls back to specUrl origin when host is missing', () => {
    const api = { swagger: '2.0', info: { title: 'Test', version: '1' } } as OpenAPIV2.Document
    expect(extractSwagger2BaseUrl(api, 'https://open.gsa.gov/api/apidatagov/v1/openapi.yaml')).toBe('https://open.gsa.gov')
  })

  it('falls back to specUrl origin with basePath', () => {
    const api = { basePath: '/v2' } as OpenAPIV2.Document
    expect(extractSwagger2BaseUrl(api, 'https://example.com/docs/spec.yaml')).toBe('https://example.com/v2')
  })

  it('uses specUrl scheme when host is missing and no schemes in spec', () => {
    const api = {} as OpenAPIV2.Document
    expect(extractSwagger2BaseUrl(api, 'http://localhost:8080/spec.yaml')).toBe('http://localhost:8080')
  })

  it('prefers spec schemes over specUrl scheme', () => {
    const api = { schemes: ['https'] } as unknown as OpenAPIV2.Document
    expect(extractSwagger2BaseUrl(api, 'http://localhost:8080/spec.yaml')).toBe('https://localhost:8080')
  })

  it('returns empty when specUrl is not a valid URL', () => {
    const api = {} as OpenAPIV2.Document
    expect(extractSwagger2BaseUrl(api, 'not-a-url')).toBe('')
  })

  it('returns empty when specUrl is an empty string', () => {
    const api = {} as OpenAPIV2.Document
    expect(extractSwagger2BaseUrl(api, '')).toBe('')
  })

  it('preserves trailing slash on basePath with specUrl fallback', () => {
    const api = { basePath: '/v2/' } as OpenAPIV2.Document
    expect(extractSwagger2BaseUrl(api, 'https://example.com/docs/spec.yaml')).toBe('https://example.com/v2/')
  })
})
