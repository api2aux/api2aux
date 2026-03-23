import { describe, it, expect } from 'vitest'
import { isSpecUrl, isSpecContent, isGraphQLUrl } from './detection'

describe('isSpecUrl', () => {
  it('detects OpenAPI JSON/YAML extensions', () => {
    expect(isSpecUrl('https://api.example.com/openapi.json')).toBe(true)
    expect(isSpecUrl('https://api.example.com/openapi.yaml')).toBe(true)
    expect(isSpecUrl('https://api.example.com/openapi.yml')).toBe(true)
  })

  it('detects Swagger JSON/YAML extensions', () => {
    expect(isSpecUrl('https://api.example.com/swagger.json')).toBe(true)
    expect(isSpecUrl('https://api.example.com/swagger.yaml')).toBe(true)
    expect(isSpecUrl('https://api.example.com/swagger.yml')).toBe(true)
  })

  it('detects spec.json/yaml extensions', () => {
    expect(isSpecUrl('https://api.example.com/spec.json')).toBe(true)
    expect(isSpecUrl('https://api.example.com/spec.yaml')).toBe(true)
    expect(isSpecUrl('https://api.example.com/spec.yml')).toBe(true)
  })

  it('detects api-docs paths', () => {
    expect(isSpecUrl('https://api.example.com/api-docs')).toBe(true)
    expect(isSpecUrl('https://api.example.com/api-docs.json')).toBe(true)
    expect(isSpecUrl('https://api.example.com/api-docs.yaml')).toBe(true)
    expect(isSpecUrl('https://api.example.com/v2/api-docs')).toBe(true)
    expect(isSpecUrl('https://api.example.com/v3/api-docs')).toBe(true)
  })

  it('detects URLs containing swagger or openapi anywhere', () => {
    expect(isSpecUrl('https://api.example.com/v1/swagger/ui')).toBe(true)
    expect(isSpecUrl('https://api.example.com/openapi/v3')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isSpecUrl('https://api.example.com/OpenAPI.JSON')).toBe(true)
    expect(isSpecUrl('https://api.example.com/SWAGGER.yaml')).toBe(true)
  })

  it('rejects non-spec URLs', () => {
    expect(isSpecUrl('https://api.example.com/users')).toBe(false)
    expect(isSpecUrl('https://api.example.com/api/v1')).toBe(false)
    expect(isSpecUrl('https://data.healthcare.gov/api/1')).toBe(false)
  })
})

describe('isSpecContent', () => {
  it('detects OpenAPI 3.x specs', () => {
    expect(isSpecContent({ openapi: '3.0.3', info: {}, paths: {} })).toBe(true)
    expect(isSpecContent({ openapi: '3.1.0', info: {}, paths: {} })).toBe(true)
  })

  it('detects Swagger 2.0 specs', () => {
    expect(isSpecContent({ swagger: '2.0', info: {}, paths: {} })).toBe(true)
  })

  it('rejects non-spec objects', () => {
    expect(isSpecContent({ users: [], total: 10 })).toBe(false)
    expect(isSpecContent({ id: 1, name: 'test' })).toBe(false)
  })

  it('rejects non-string openapi/swagger values', () => {
    expect(isSpecContent({ openapi: 3 })).toBe(false)
    expect(isSpecContent({ swagger: true })).toBe(false)
    expect(isSpecContent({ openapi: null })).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(isSpecContent(null)).toBe(false)
    expect(isSpecContent(undefined)).toBe(false)
    expect(isSpecContent('string')).toBe(false)
    expect(isSpecContent(42)).toBe(false)
    expect(isSpecContent([{ openapi: '3.0.0' }])).toBe(false)
  })
})

describe('isGraphQLUrl', () => {
  it('detects /graphql endpoints', () => {
    expect(isGraphQLUrl('https://api.example.com/graphql')).toBe(true)
    expect(isGraphQLUrl('https://api.example.com/v1/graphql')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isGraphQLUrl('https://api.example.com/GraphQL')).toBe(true)
    expect(isGraphQLUrl('https://api.example.com/GRAPHQL')).toBe(true)
  })

  it('rejects non-GraphQL URLs', () => {
    expect(isGraphQLUrl('https://api.example.com/users')).toBe(false)
    expect(isGraphQLUrl('https://api.example.com/api/graphql-schema')).toBe(false)
  })

  it('handles invalid URLs gracefully', () => {
    expect(isGraphQLUrl('not-a-url')).toBe(false)
    expect(isGraphQLUrl('')).toBe(false)
  })
})
