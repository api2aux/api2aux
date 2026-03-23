import { describe, it, expect } from 'vitest'
import { hasGraphQLErrors, getGraphQLErrors, throwOnGraphQLErrors } from './errors'
import { API_INVOKE_ERROR_NAME, ErrorKind } from '../../core/errors'
import type { ExecutionResult } from '../../core/types'

function makeResult(data: unknown): ExecutionResult {
  return {
    status: 200,
    data,
    contentType: 'application/json',
    headers: {},
    request: { method: 'POST', url: 'https://api.example.com/graphql', headers: {} },
    elapsedMs: 50,
  }
}

describe('hasGraphQLErrors', () => {
  it('returns false for successful response', () => {
    expect(hasGraphQLErrors(makeResult({ data: { user: { name: 'Alice' } } }))).toBe(false)
  })

  it('returns true for error response', () => {
    expect(hasGraphQLErrors(makeResult({ errors: [{ message: 'Not found' }] }))).toBe(true)
  })

  it('returns true for partial error (data + errors)', () => {
    expect(hasGraphQLErrors(makeResult({ data: { user: null }, errors: [{ message: 'Field error' }] }))).toBe(true)
  })

  it('returns false for null data', () => {
    expect(hasGraphQLErrors(makeResult(null))).toBe(false)
  })
})

describe('getGraphQLErrors', () => {
  it('returns empty array for successful response', () => {
    expect(getGraphQLErrors(makeResult({ data: { user: {} } }))).toEqual([])
  })

  it('extracts error objects', () => {
    const errors = [{ message: 'Bad query', locations: [{ line: 1, column: 5 }] }]
    expect(getGraphQLErrors(makeResult({ errors }))).toEqual(errors)
  })
})

describe('throwOnGraphQLErrors', () => {
  it('does not throw for successful response', () => {
    expect(() => throwOnGraphQLErrors(makeResult({ data: { user: {} } }))).not.toThrow()
  })

  it('throws when data is null and errors present', () => {
    const result = makeResult({ data: null, errors: [{ message: 'Syntax error' }] })
    expect(() => throwOnGraphQLErrors(result)).toThrow('GraphQL errors: Syntax error')
  })

  it('throws with ApiInvokeError properties', () => {
    const body = { data: null, errors: [{ message: 'Bad' }] }
    const result = makeResult(body)
    try {
      throwOnGraphQLErrors(result)
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toMatchObject({
        name: API_INVOKE_ERROR_NAME,
        kind: ErrorKind.GRAPHQL,
        retryable: false,
        status: 200,
        responseBody: body,
      })
    }
  })

  it('does not throw for partial errors (data + errors)', () => {
    const result = makeResult({ data: { user: { name: 'Alice' } }, errors: [{ message: 'Minor issue' }] })
    expect(() => throwOnGraphQLErrors(result)).not.toThrow()
  })

  it('does not throw when no errors array', () => {
    expect(() => throwOnGraphQLErrors(makeResult({ data: {} }))).not.toThrow()
  })

  it('joins multiple error messages', () => {
    const result = makeResult({ data: null, errors: [{ message: 'Error 1' }, { message: 'Error 2' }] })
    expect(() => throwOnGraphQLErrors(result)).toThrow('Error 1; Error 2')
  })
})
