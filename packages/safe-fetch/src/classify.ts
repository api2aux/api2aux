import ipaddr from 'ipaddr.js'

/**
 * Returns true only for genuinely public unicast IP addresses (both IPv4 and IPv6).
 *
 * Uses ipaddr.js's `range()` classifier, which returns 'unicast' only for addresses
 * that are not in any reserved/private/special range. Everything else is rejected:
 * - IPv4: private (10/8, 172.16/12, 192.168/16), loopback (127/8), link-local
 *   (169.254/16), CGNAT (100.64/10), TEST-NET, multicast, broadcast, reserved, etc.
 * - IPv6: loopback (::1), link-local (fe80::/10), unique-local (fc00::/7),
 *   IPv4-mapped (::ffff:.../96), 6to4 (2002::/16), Teredo, documentation
 *   (2001:db8::/32), reserved, multicast.
 *
 * This blocks all known SSRF target ranges including DNS-rebinding bypasses
 * via IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) and 6to4 wrapping of private v4.
 */
export function isPublicUnicast(addr: string): boolean {
  try {
    return ipaddr.parse(addr).range() === 'unicast'
  } catch {
    return false
  }
}
