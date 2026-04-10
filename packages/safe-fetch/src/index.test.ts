import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createSafeFetch, SsrfBlockedError } from './index.js'

describe('createSafeFetch', () => {
  describe('preflight (synchronous)', () => {
    const safeFetch = createSafeFetch()

    it('throws SsrfBlockedError synchronously for invalid URL', async () => {
      // safeFetch is async, but preflight runs before any await — the error
      // surfaces in the rejected promise (not as a thrown exception).
      await expect(safeFetch('not-a-url' as string)).rejects.toThrow(SsrfBlockedError)
    })

    it('throws SsrfBlockedError for non-http(s) protocols', async () => {
      await expect(safeFetch('javascript:alert(1)')).rejects.toThrow(/protocol/)
      await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/protocol/)
    })

    it('throws SsrfBlockedError for embedded credentials', async () => {
      await expect(safeFetch('http://user:pass@example.com/')).rejects.toThrow(/credentials/)
    })

  })

  describe('obfuscated IPv4 forms (canonicalized by URL parser, then rejected by agent)', () => {
    const safeFetch = createSafeFetch()

    // Node's URL parser canonicalizes these to 127.0.0.1 before preflight sees them.
    // The agent then rejects 127.0.0.1 as non-public-unicast. End result: blocked.
    const obfuscated = [
      'http://0177.0.0.1/', // octal
      'http://0x7f.0.0.1/', // hex
      'http://127.1/', // 2-octet shorthand
      'http://2130706433/', // single-integer shorthand
    ]
    it.each(obfuscated)('rejects %s as a private IP after canonicalization', async (url) => {
      try {
        await safeFetch(url)
        throw new Error('expected SsrfBlockedError to be thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(SsrfBlockedError)
        expect((err as SsrfBlockedError).reason).toMatch(/127\.0\.0\.1/)
      }
    })
  })

  describe('agent-level rejection (literal private IP)', () => {
    const safeFetch = createSafeFetch()

    it('rejects http://127.0.0.1 with SsrfBlockedError (not TypeError)', async () => {
      try {
        await safeFetch('http://127.0.0.1/')
        throw new Error('expected SsrfBlockedError to be thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(SsrfBlockedError)
        expect((err as SsrfBlockedError).reason).toMatch(/127\.0\.0\.1/)
      }
    })

    it('rejects AWS metadata endpoint', async () => {
      try {
        await safeFetch('http://169.254.169.254/latest/meta-data/')
        throw new Error('expected SsrfBlockedError to be thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(SsrfBlockedError)
      }
    })

    it('rejects IPv6 loopback', async () => {
      try {
        await safeFetch('http://[::1]/')
        throw new Error('expected SsrfBlockedError to be thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(SsrfBlockedError)
      }
    })
  })

  describe('allowHosts escape hatch — real local server', () => {
    let server: Server
    let port: number

    beforeAll(async () => {
      server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, source: 'test-server' }))
      })
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve())
      })
      const addr = server.address() as AddressInfo
      port = addr.port
    })

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    })

    it('fetches from 127.0.0.1 when in allowHosts', async () => {
      const safeFetch = createSafeFetch({ allowHosts: ['127.0.0.1'] })
      const response = await safeFetch(`http://127.0.0.1:${port}/`)
      expect(response.ok).toBe(true)
      const body = (await response.json()) as { ok: boolean; source: string }
      expect(body.ok).toBe(true)
      expect(body.source).toBe('test-server')
    })

    it('still rejects 127.0.0.1 when NOT in allowHosts', async () => {
      const safeFetch = createSafeFetch()
      await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(SsrfBlockedError)
    })

    it('rejects other private IPs even when localhost is allowed', async () => {
      const safeFetch = createSafeFetch({ allowHosts: ['127.0.0.1'] })
      await expect(safeFetch('http://10.0.0.1/')).rejects.toThrow(SsrfBlockedError)
    })
  })

  describe('error unwrapping', () => {
    it('SsrfBlockedError is exposed directly, not wrapped in TypeError', async () => {
      const safeFetch = createSafeFetch()
      try {
        await safeFetch('http://127.0.0.1/')
      } catch (err) {
        // The critical assertion: the caught error IS SsrfBlockedError, not a
        // generic TypeError("fetch failed") with cause set. Callers can do a
        // simple `instanceof SsrfBlockedError` check without walking the cause chain.
        expect(err).toBeInstanceOf(SsrfBlockedError)
        expect(err).not.toBeInstanceOf(TypeError)
      }
    })
  })
})
