import { describe, it, expect } from 'vitest'
import { isPublicUnicast } from './classify.js'

describe('isPublicUnicast', () => {
  describe('IPv4 — private and reserved ranges (rejected)', () => {
    const blocked = [
      // RFC 1918 private
      ['10.0.0.1', 'private 10/8'],
      ['10.255.255.254', 'private 10/8 upper'],
      ['172.16.0.1', 'private 172.16/12 lower'],
      ['172.31.255.254', 'private 172.16/12 upper'],
      ['192.168.0.1', 'private 192.168/16 lower'],
      ['192.168.255.254', 'private 192.168/16 upper'],
      // Loopback
      ['127.0.0.1', 'loopback'],
      ['127.255.255.254', 'loopback range'],
      // Link-local
      ['169.254.0.1', 'link-local (AWS metadata)'],
      ['169.254.169.254', 'AWS metadata service'],
      // Current network / unspecified
      ['0.0.0.0', 'unspecified'],
      ['0.255.255.254', 'current-network range'],
      // CGNAT
      ['100.64.0.1', 'carrier-grade NAT'],
      ['100.127.255.254', 'CGNAT upper'],
      // Multicast
      ['224.0.0.1', 'multicast'],
      ['239.255.255.254', 'multicast upper'],
      // Reserved (240/4)
      ['240.0.0.1', 'reserved'],
      ['255.255.255.254', 'reserved upper'],
      // Broadcast
      ['255.255.255.255', 'broadcast'],
    ]
    it.each(blocked)('rejects %s (%s)', (addr) => {
      expect(isPublicUnicast(addr)).toBe(false)
    })
  })

  describe('IPv4 — public unicast (allowed)', () => {
    const allowed = [
      '8.8.8.8', // Google DNS
      '1.1.1.1', // Cloudflare DNS
      '172.67.205.42', // Cloudflare (172.67 is NOT in the private 172.16-31 range)
      '93.184.216.34', // example.com
      '52.84.150.39', // arbitrary AWS public
    ]
    it.each(allowed)('allows %s', (addr) => {
      expect(isPublicUnicast(addr)).toBe(true)
    })
  })

  describe('IPv6 — private and reserved (rejected)', () => {
    const blocked = [
      ['::1', 'loopback'],
      ['fe80::1', 'link-local'],
      ['fe80::dead:beef', 'link-local with suffix'],
      ['fc00::1', 'unique-local lower'],
      ['fd00::1', 'unique-local upper'],
      ['2001:db8::1', 'documentation'],
      ['::ffff:127.0.0.1', 'IPv4-mapped private (dotted form)'],
      ['::ffff:7f00:1', 'IPv4-mapped private (hex form)'],
      ['::ffff:8.8.8.8', 'IPv4-mapped public — still rejected (deprecated form)'],
      ['ff00::1', 'multicast'],
    ]
    it.each(blocked)('rejects %s (%s)', (addr) => {
      expect(isPublicUnicast(addr)).toBe(false)
    })
  })

  describe('IPv6 — public unicast (allowed)', () => {
    const allowed = [
      '2606:4700:3031::ac43:cd2a', // Cloudflare (the original bug case)
      '2001:4860:4860::8888', // Google DNS IPv6
      '2620:fe::fe', // Quad9
    ]
    it.each(allowed)('allows %s', (addr) => {
      expect(isPublicUnicast(addr)).toBe(true)
    })
  })

  describe('invalid input', () => {
    it('returns false for invalid strings (no leakage)', () => {
      expect(isPublicUnicast('not-an-ip')).toBe(false)
      expect(isPublicUnicast('')).toBe(false)
      expect(isPublicUnicast('999.999.999.999')).toBe(false)
      expect(isPublicUnicast('::gg::')).toBe(false)
    })
  })
})
