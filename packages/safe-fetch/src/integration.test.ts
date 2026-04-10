/**
 * Integration test: proves the load-bearing security property of @api2aux/safe-fetch.
 *
 * The core claim is: "undici calls our connect.lookup on every new connection,
 * and the TCP socket is pinned to the IP our lookup returned." This test verifies
 * that claim end-to-end by mocking DNS, spinning up a real local HTTP server,
 * fetching via a fake hostname, and asserting both that (a) the request reaches
 * the real server (proving the validated IP was used for the TCP connection) and
 * (b) the mock was called (proving undici invoked our lookup, not its default).
 *
 * This file MUST be separate from index.test.ts because vi.mock('node:dns/promises')
 * is file-scoped and would interfere with tests that rely on real DNS.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// Mock DNS before any safe-fetch module is imported — vi.mock is hoisted.
const dnsLookupMock = vi.fn()
vi.mock('node:dns/promises', () => ({
  lookup: dnsLookupMock,
}))

// Mock the classifier so 127.0.0.1 (our local test server) is treated as "public."
// This lets us test the undici plumbing (lookup invoked + IP pinned) in isolation.
// The actual classification logic (127.0.0.1 is private) is verified separately
// by classify.test.ts (38 cases). Together: classify proves the policy, this file
// proves the enforcement mechanism.
vi.mock('./classify.js', () => ({
  isPublicUnicast: (addr: string) => {
    // Only treat 127.0.0.1 as "public" for integration testing
    if (addr === '127.0.0.1') return true
    // Everything else uses real classification
    const ipaddr = require('ipaddr.js')
    try { return ipaddr.parse(addr).range() === 'unicast' } catch { return false }
  },
}))

const { createSafeFetch, SsrfBlockedError } = await import('./index.js')

describe('undici-level DNS integration', () => {
  let server: Server
  let port: number

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ host: req.headers.host, path: req.url }))
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  })

  beforeEach(() => {
    dnsLookupMock.mockReset()
  })

  it('routes a hostname-based request through our lookup and connects to the validated IP', async () => {
    // Mock DNS: fake-host.test resolves to 127.0.0.1 (our local server)
    dnsLookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])

    const safeFetch = createSafeFetch()
    const response = await safeFetch(`http://fake-host.test:${port}/hello`)
    expect(response.ok).toBe(true)

    const body = (await response.json()) as { host: string; path: string }
    // The request reached our local server — proving undici connected to 127.0.0.1
    expect(body.path).toBe('/hello')
    // The Host header uses the original hostname (not the resolved IP)
    expect(body.host).toBe(`fake-host.test:${port}`)
    // Our lookup was called (undici invoked it, not its default resolver)
    expect(dnsLookupMock).toHaveBeenCalledWith(
      'fake-host.test',
      expect.objectContaining({ all: true }),
    )
  })

  it('calls lookup on each new connection (no stale-IP caching)', async () => {
    // Both calls resolve to our local server
    dnsLookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])

    const safeFetch = createSafeFetch()

    // First fetch
    const r1 = await safeFetch(`http://fresh-host-1.test:${port}/1`)
    expect(r1.ok).toBe(true)
    await r1.text() // consume body to release connection

    // Second fetch to a DIFFERENT hostname (forces a new connection)
    const r2 = await safeFetch(`http://fresh-host-2.test:${port}/2`)
    expect(r2.ok).toBe(true)
    await r2.text()

    // Both hostnames triggered a lookup call
    expect(dnsLookupMock).toHaveBeenCalledWith(
      'fresh-host-1.test',
      expect.objectContaining({ all: true }),
    )
    expect(dnsLookupMock).toHaveBeenCalledWith(
      'fresh-host-2.test',
      expect.objectContaining({ all: true }),
    )
  })

  it('blocks DNS rebinding: second lookup returns private IP → connection rejected', async () => {
    // First call: public IP (allowed)
    dnsLookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
    // Second call: same hostname, but DNS now returns a private address (rebinding)
    dnsLookupMock.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }])

    const safeFetch = createSafeFetch()

    // First fetch succeeds (127.0.0.1 is public unicast — in real life this would
    // be some external IP, but for this test we use localhost as the "trusted" IP)
    const r1 = await safeFetch(`http://rebind.test:${port}/1`)
    expect(r1.ok).toBe(true)
    await r1.text()

    // Second fetch: DNS returns 10.0.0.1 (private) → blocked
    await expect(safeFetch(`http://rebind.test:${port}/2`)).rejects.toThrow(SsrfBlockedError)
  })

  it('preserves SsrfBlockedError identity through undici error wrapping', async () => {
    // Hostname resolves to a private IP
    dnsLookupMock.mockResolvedValue([{ address: '192.168.1.1', family: 4 }])

    const safeFetch = createSafeFetch()
    try {
      await safeFetch(`http://evil.test:${port}/steal`)
      throw new Error('expected SsrfBlockedError')
    } catch (err) {
      // The error MUST be SsrfBlockedError, not TypeError("fetch failed")
      expect(err).toBeInstanceOf(SsrfBlockedError)
      expect(err).not.toBeInstanceOf(TypeError)
      expect((err as InstanceType<typeof SsrfBlockedError>).reason).toMatch(/192\.168\.1\.1/)
    }
  })
})
