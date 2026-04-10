import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock node:dns/promises BEFORE importing the agent module so the agent's
// internal dnsLookup reference points at our mock.
const dnsLookupMock = vi.fn()
vi.mock('node:dns/promises', () => ({
  lookup: dnsLookupMock,
}))

const { buildSafeLookup } = await import('./agent.js')
const { SsrfBlockedError } = await import('./errors.js')

interface CallResult {
  err: Error | null
  address?: unknown
  family?: number
}

/** Promisify the lookup callback for ergonomic tests. */
function callLookup(
  allowHosts: ReadonlySet<string>,
  hostname: string,
  opts: { family?: number; all?: boolean } = {},
): Promise<CallResult> {
  const lookup = buildSafeLookup(allowHosts)
  return new Promise((resolve) => {
    lookup(hostname, opts, (err, address, family) => {
      resolve({ err: err ?? null, address, family })
    })
  })
}

const NO_ALLOW = new Set<string>()

describe('buildSafeLookup', () => {
  beforeEach(() => {
    dnsLookupMock.mockReset()
  })

  describe('literal IP — validated without DNS', () => {
    it('returns scalar (address, family) for a public IPv4 literal', async () => {
      const result = await callLookup(NO_ALLOW, '8.8.8.8')
      expect(result.err).toBeNull()
      expect(result.address).toBe('8.8.8.8')
      expect(result.family).toBe(4)
      expect(dnsLookupMock).not.toHaveBeenCalled()
    })

    it('returns scalar (address, family) for a public IPv6 literal', async () => {
      const result = await callLookup(NO_ALLOW, '2606:4700:3031::ac43:cd2a')
      expect(result.err).toBeNull()
      expect(result.address).toBe('2606:4700:3031::ac43:cd2a')
      expect(result.family).toBe(6)
      expect(dnsLookupMock).not.toHaveBeenCalled()
    })

    it('rejects a private IPv4 literal with SsrfBlockedError', async () => {
      const result = await callLookup(NO_ALLOW, '127.0.0.1')
      expect(result.err).toBeInstanceOf(SsrfBlockedError)
      expect((result.err as SsrfBlockedError).reason).toMatch(/127\.0\.0\.1/)
      expect(dnsLookupMock).not.toHaveBeenCalled()
    })

    it('rejects an IPv6 loopback literal', async () => {
      const result = await callLookup(NO_ALLOW, '::1')
      expect(result.err).toBeInstanceOf(SsrfBlockedError)
    })

    it('rejects AWS metadata IP literal', async () => {
      const result = await callLookup(NO_ALLOW, '169.254.169.254')
      expect(result.err).toBeInstanceOf(SsrfBlockedError)
    })

    it('honors opts.all for literal IPs', async () => {
      const result = await callLookup(NO_ALLOW, '8.8.8.8', { all: true })
      expect(result.err).toBeNull()
      expect(result.address).toEqual([{ address: '8.8.8.8', family: 4 }])
    })
  })

  describe('hostname — DNS resolution', () => {
    it('returns first address when all records are public', async () => {
      dnsLookupMock.mockResolvedValueOnce([
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ])
      const result = await callLookup(NO_ALLOW, 'example.com')
      expect(result.err).toBeNull()
      expect(result.address).toBe('93.184.216.34')
      expect(result.family).toBe(4)
      expect(dnsLookupMock).toHaveBeenCalledWith('example.com', { all: true, family: 0 })
    })

    it('rejects when ANY record is non-public (mixed public/private)', async () => {
      dnsLookupMock.mockResolvedValueOnce([
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ])
      const result = await callLookup(NO_ALLOW, 'mixed.example.com')
      expect(result.err).toBeInstanceOf(SsrfBlockedError)
      expect((result.err as SsrfBlockedError).reason).toMatch(/10\.0\.0\.1/)
    })

    it('rejects when all records are private', async () => {
      dnsLookupMock.mockResolvedValueOnce([{ address: '192.168.1.1', family: 4 }])
      const result = await callLookup(NO_ALLOW, 'router.local')
      expect(result.err).toBeInstanceOf(SsrfBlockedError)
    })

    it('rejects empty resolution result', async () => {
      dnsLookupMock.mockResolvedValueOnce([])
      const result = await callLookup(NO_ALLOW, 'nodata.example.com')
      expect(result.err).toBeInstanceOf(SsrfBlockedError)
      expect((result.err as SsrfBlockedError).reason).toMatch(/no addresses/)
    })

    it('propagates DNS resolution errors', async () => {
      const dnsErr = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
      dnsLookupMock.mockRejectedValueOnce(dnsErr)
      const result = await callLookup(NO_ALLOW, 'doesnotexist.example.invalid')
      expect(result.err).toBe(dnsErr)
    })

    it('honors opts.all by returning the full address array', async () => {
      const addrs = [
        { address: '8.8.8.8', family: 4 },
        { address: '8.8.4.4', family: 4 },
      ]
      dnsLookupMock.mockResolvedValueOnce(addrs)
      const result = await callLookup(NO_ALLOW, 'dns.example.com', { all: true })
      expect(result.err).toBeNull()
      expect(result.address).toEqual(addrs)
    })

    it('passes opts.family through to dns.lookup', async () => {
      dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      await callLookup(NO_ALLOW, 'example.com', { family: 4 })
      expect(dnsLookupMock).toHaveBeenCalledWith('example.com', { all: true, family: 4 })
    })

    it('rejects the dummyjson.com IPv6 case from the original bug', async () => {
      // Verify the original bug regression: an IPv6 address that's actually
      // public (Cloudflare) is correctly accepted, not falsely flagged as private.
      dnsLookupMock.mockResolvedValueOnce([
        { address: '2606:4700:3031::ac43:cd2a', family: 6 },
        { address: '172.67.205.42', family: 4 },
      ])
      const result = await callLookup(NO_ALLOW, 'dummyjson.com')
      expect(result.err).toBeNull()
      expect(result.address).toBe('2606:4700:3031::ac43:cd2a')
    })
  })

  describe('DNS rebinding scenario', () => {
    it('re-validates on every call (no cached pass)', async () => {
      // First call: returns public, succeeds
      dnsLookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      const first = await callLookup(NO_ALLOW, 'rebind.example.com')
      expect(first.err).toBeNull()

      // Second call: same hostname, but DNS now returns private (rebinding)
      dnsLookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      const second = await callLookup(NO_ALLOW, 'rebind.example.com')
      expect(second.err).toBeInstanceOf(SsrfBlockedError)
      expect((second.err as SsrfBlockedError).reason).toMatch(/127\.0\.0\.1/)
    })
  })

  describe('allowHosts bypass', () => {
    const allow = new Set(['localhost', '127.0.0.1'])

    it('skips classification for hostnames in the allowlist', async () => {
      dnsLookupMock.mockResolvedValueOnce({ address: '127.0.0.1', family: 4 })
      const result = await callLookup(allow, 'localhost')
      expect(result.err).toBeNull()
      expect(result.address).toBe('127.0.0.1')
      expect(dnsLookupMock).toHaveBeenCalled()
    })

    it('skips classification for literal IPs in the allowlist', async () => {
      dnsLookupMock.mockResolvedValueOnce({ address: '127.0.0.1', family: 4 })
      const result = await callLookup(allow, '127.0.0.1')
      expect(result.err).toBeNull()
      // Note: even literal IPs go through DNS lookup when in allowHosts —
      // we don't short-circuit, we delegate to the system resolver. This is fine
      // because the system resolver returns the literal as-is for IP inputs.
    })

    it('still rejects hosts NOT in the allowlist', async () => {
      const result = await callLookup(allow, '169.254.169.254')
      expect(result.err).toBeInstanceOf(SsrfBlockedError)
    })
  })
})
