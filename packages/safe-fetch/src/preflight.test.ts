import { describe, it, expect } from 'vitest'
import { preflight } from './preflight.js'
import { SsrfBlockedError } from './errors.js'

const NO_ALLOW = new Set<string>()

describe('preflight', () => {
  describe('valid URLs', () => {
    it('accepts canonical https URLs', () => {
      const url = preflight('https://dummyjson.com/recipes', NO_ALLOW)
      expect(url.hostname).toBe('dummyjson.com')
    })

    it('accepts http URLs with port and query', () => {
      const url = preflight('http://example.com:8080/foo?bar=baz', NO_ALLOW)
      expect(url.port).toBe('8080')
      expect(url.search).toBe('?bar=baz')
    })

    it('accepts URL instances', () => {
      const input = new URL('https://api.github.com/users')
      const url = preflight(input, NO_ALLOW)
      expect(url.href).toBe(input.href)
    })

    it('accepts canonical IPv4 dotted-quad public addresses', () => {
      // pre-flight only checks form — IP classification happens at the agent
      expect(() => preflight('http://8.8.8.8/foo', NO_ALLOW)).not.toThrow()
    })
  })

  describe('protocol allowlist', () => {
    const blockedProtocols = [
      'ftp://example.com/file',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'gopher://example.com',
      'ws://example.com',
      'wss://example.com',
    ]
    it.each(blockedProtocols)('rejects %s', (urlString) => {
      expect(() => preflight(urlString, NO_ALLOW)).toThrow(SsrfBlockedError)
    })
  })

  describe('embedded credentials', () => {
    it('rejects URL with username', () => {
      expect(() => preflight('http://user@example.com/', NO_ALLOW)).toThrow(SsrfBlockedError)
    })
    it('rejects URL with username and password', () => {
      expect(() => preflight('https://user:pass@example.com/', NO_ALLOW)).toThrow(SsrfBlockedError)
    })
  })

  describe('obfuscated IPv4 forms (canonicalized by URL parser, rejected at preflight)', () => {
    // Node's WHATWG URL parser normalizes these to dotted-quad BEFORE preflight runs.
    // Preflight then sees the canonical form (127.0.0.1) and rejects it via literal-IP
    // classification. End-to-end rejection is verified in index.test.ts.
    const obfuscated = [
      ['http://0177.0.0.1/', 'octal'],
      ['http://0x7f.0.0.1/', 'hex'],
      ['http://127.1/', '2-octet shorthand'],
      ['http://127.0.1/', '3-octet shorthand'],
      ['http://2130706433/', 'single-integer shorthand'],
    ]
    it.each(obfuscated)('rejects %s (%s)', (url) => {
      expect(() => preflight(url, NO_ALLOW)).toThrow(SsrfBlockedError)
      expect(() => preflight(url, NO_ALLOW)).toThrow(/127\.0\.0\.1/)
    })
  })

  describe('literal-IP classification', () => {
    it('rejects literal 127.0.0.1', () => {
      expect(() => preflight('http://127.0.0.1/', NO_ALLOW)).toThrow(/127\.0\.0\.1/)
    })
    it('rejects AWS metadata 169.254.169.254', () => {
      expect(() => preflight('http://169.254.169.254/', NO_ALLOW)).toThrow(/169\.254\.169\.254/)
    })
    it('rejects RFC1918 10.0.0.1', () => {
      expect(() => preflight('http://10.0.0.1/', NO_ALLOW)).toThrow(SsrfBlockedError)
    })
    it('rejects IPv6 loopback http://[::1]/', () => {
      expect(() => preflight('http://[::1]/', NO_ALLOW)).toThrow(SsrfBlockedError)
    })
    it('allows public IPv4 literal http://8.8.8.8/', () => {
      const url = preflight('http://8.8.8.8/', NO_ALLOW)
      expect(url.hostname).toBe('8.8.8.8')
    })
    it('allows public IPv6 literal (Cloudflare from the original bug)', () => {
      const url = preflight('http://[2606:4700:3031::ac43:cd2a]/', NO_ALLOW)
      // hostname comes back bracketed
      expect(url.hostname).toContain('2606:4700:3031')
    })
  })

  describe('malformed input', () => {
    it('rejects unparseable strings', () => {
      expect(() => preflight('not-a-url', NO_ALLOW)).toThrow(/invalid URL/)
    })
    it('rejects empty string', () => {
      expect(() => preflight('', NO_ALLOW)).toThrow(/invalid URL/)
    })
  })

  describe('allowHosts bypass', () => {
    const allow = new Set(['localhost', '127.0.0.1'])
    it('allows localhost when in allowHosts', () => {
      const url = preflight('http://localhost:3000/api', allow)
      expect(url.hostname).toBe('localhost')
    })
    it('allows literal 127.0.0.1 when in allowHosts', () => {
      const url = preflight('http://127.0.0.1:8080/', allow)
      expect(url.hostname).toBe('127.0.0.1')
    })
    it('still rejects literal IPs not in the allowlist at preflight', () => {
      // 169.254.169.254 is a literal IP — preflight classifies it directly
      // (undici skips connect.lookup for literal IPs, so preflight is the boundary).
      expect(() => preflight('http://169.254.169.254/', allow)).toThrow(SsrfBlockedError)
    })
  })
})
