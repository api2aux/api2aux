import { describe, it, expect, vi } from 'vitest'
import { withRetry } from './retry'

function mockFetch(responses: Array<{ status: number; headers?: Record<string, string> }>): typeof globalThis.fetch {
  let call = 0
  return vi.fn(async () => {
    const r = responses[call++]
    if (!r) throw new Error('Unexpected call')
    return new Response(JSON.stringify({ ok: true }), {
      status: r.status,
      headers: r.headers,
    })
  }) as unknown as typeof globalThis.fetch
}

function throwingFetch(errors: Array<Error | { status: number }>): typeof globalThis.fetch {
  let call = 0
  return vi.fn(async () => {
    const item = errors[call++]
    if (!item) throw new Error('Unexpected call')
    if (item instanceof Error) throw item
    return new Response(null, { status: item.status })
  }) as unknown as typeof globalThis.fetch
}

describe('withRetry', () => {
  it('returns response on success without retry', async () => {
    const base = mockFetch([{ status: 200 }])
    const fetch = withRetry({ maxRetries: 3 }, base)
    const res = await fetch('https://api.example.com/test')
    expect(res.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('retries on 500 and succeeds', async () => {
    const base = mockFetch([{ status: 500 }, { status: 500 }, { status: 200 }])
    const fetch = withRetry({ maxRetries: 3, initialDelayMs: 1 }, base)
    const res = await fetch('https://api.example.com/test')
    expect(res.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(3)
  })

  it('retries on 429 rate limit', async () => {
    const base = mockFetch([{ status: 429 }, { status: 200 }])
    const fetch = withRetry({ maxRetries: 2, initialDelayMs: 1 }, base)
    const res = await fetch('https://api.example.com/test')
    expect(res.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('does not retry on 400 client error', async () => {
    const base = mockFetch([{ status: 400 }])
    const fetch = withRetry({ maxRetries: 3, initialDelayMs: 1 }, base)
    const res = await fetch('https://api.example.com/test')
    expect(res.status).toBe(400)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('returns last response when retries exhausted', async () => {
    const base = mockFetch([{ status: 503 }, { status: 503 }])
    const fetch = withRetry({ maxRetries: 1, initialDelayMs: 1 }, base)
    const res = await fetch('https://api.example.com/test')
    expect(res.status).toBe(503)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('retries on network errors', async () => {
    const base = throwingFetch([
      new TypeError('Failed to fetch'),
      { status: 200 },
    ])
    const fetch = withRetry({ maxRetries: 2, initialDelayMs: 1 }, base)
    const res = await fetch('https://api.example.com/test')
    expect(res.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('throws when all retries fail with network error', async () => {
    const base = throwingFetch([
      new TypeError('Failed to fetch'),
      new TypeError('Failed to fetch'),
    ])
    const fetch = withRetry({ maxRetries: 1, initialDelayMs: 1 }, base)
    await expect(fetch('https://api.example.com/test')).rejects.toThrow('Failed to fetch')
  })

  it('respects Retry-After header (seconds)', async () => {
    const base = mockFetch([
      { status: 429, headers: { 'retry-after': '0' } },
      { status: 200 },
    ])
    const fetch = withRetry({ maxRetries: 2, initialDelayMs: 1 }, base)
    const res = await fetch('https://api.example.com/test')
    expect(res.status).toBe(200)
  })

  it('calls onRetry callback', async () => {
    const base = mockFetch([{ status: 503 }, { status: 200 }])
    const onRetry = vi.fn()
    const fetch = withRetry({ maxRetries: 2, initialDelayMs: 1, onRetry }, base)
    await fetch('https://api.example.com/test')
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Number), 503)
  })

  it('supports custom retryable statuses', async () => {
    const base = mockFetch([{ status: 418 }, { status: 200 }])
    const fetch = withRetry({
      maxRetries: 2,
      initialDelayMs: 1,
      retryableStatuses: [418],
    }, base)
    const res = await fetch('https://api.example.com/test')
    expect(res.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(2)
  })
})
