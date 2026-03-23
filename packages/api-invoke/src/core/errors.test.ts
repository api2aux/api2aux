import { describe, it, expect } from 'vitest'
import { corsError, networkError, authError, httpError, parseError, timeoutError, ErrorKind } from './errors'

describe('error factories', () => {
  it('creates CORS error', () => {
    const err = corsError('https://api.example.com')
    expect(err.kind).toBe(ErrorKind.CORS)
    expect(err.retryable).toBe(false)
    expect(err.suggestion).toContain('CORS')
  })

  it('creates network error (retryable)', () => {
    const err = networkError('https://api.example.com')
    expect(err.kind).toBe(ErrorKind.NETWORK)
    expect(err.retryable).toBe(true)
  })

  it('creates auth error for 401', () => {
    const err = authError('https://api.example.com', 401)
    expect(err.kind).toBe(ErrorKind.AUTH)
    expect(err.status).toBe(401)
    expect(err.retryable).toBe(false)
    expect(err.suggestion).toContain('credentials')
  })

  it('creates auth error for 403', () => {
    const err = authError('https://api.example.com', 403)
    expect(err.status).toBe(403)
    expect(err.suggestion).toContain('permission')
  })

  it('creates HTTP error for 404', () => {
    const err = httpError('https://api.example.com', 404, 'Not Found')
    expect(err.kind).toBe(ErrorKind.HTTP)
    expect(err.retryable).toBe(false)
    expect(err.suggestion).toContain('not found')
  })

  it('creates rate limit error for 429 (retryable)', () => {
    const err = httpError('https://api.example.com', 429, 'Too Many Requests')
    expect(err.kind).toBe(ErrorKind.RATE_LIMIT)
    expect(err.retryable).toBe(true)
  })

  it('creates server error for 500 (retryable)', () => {
    const err = httpError('https://api.example.com', 500, 'Internal Server Error')
    expect(err.kind).toBe(ErrorKind.HTTP)
    expect(err.retryable).toBe(true)
  })

  it('creates parse error', () => {
    const err = parseError('https://api.example.com')
    expect(err.kind).toBe(ErrorKind.PARSE)
    expect(err.retryable).toBe(false)
  })

  it('creates timeout error (retryable)', () => {
    const err = timeoutError('https://api.example.com')
    expect(err.kind).toBe(ErrorKind.TIMEOUT)
    expect(err.retryable).toBe(true)
  })
})
