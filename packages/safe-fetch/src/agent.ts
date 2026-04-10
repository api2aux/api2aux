import { Agent } from 'undici'
import { lookup as dnsLookup } from 'node:dns/promises'
import type { LookupAddress, LookupOptions } from 'node:dns'
import ipaddr from 'ipaddr.js'
import { SsrfBlockedError } from './errors.js'
import { isPublicUnicast } from './classify.js'

/**
 * Callback signature compatible with both undici's connect.lookup and Node's
 * net.LookupFunction. Mirrors `dns.LookupFunction`'s signature exactly so the
 * resulting `safeLookup` is assignable to undici's `connect.lookup` typing.
 *
 * Note: Node's strict signature requires `address` and `family` even on error,
 * so error paths pass empty/zero values that consumers ignore once `err` is set.
 */
export type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family: number,
) => void

/** Coerce Node's flexible family option (number | 'IPv4' | 'IPv6') into a numeric IP family. */
function familyAsNumber(family: number | 'IPv4' | 'IPv6' | undefined): 0 | 4 | 6 {
  if (family === 4 || family === 'IPv4') return 4
  if (family === 6 || family === 'IPv6') return 6
  return 0
}

/**
 * Build the lookup function used by {@link createSafeAgent}. Exported separately
 * so unit tests can exercise it without spinning up undici.
 *
 * The function follows Node's `net.LookupFunction` contract: signal errors via
 * the callback (not by throwing), and honor `opts.all` to choose between scalar
 * and array result shapes.
 *
 * @internal
 */
export function buildSafeLookup(allowHosts: ReadonlySet<string>) {
  // Helper that emits error via the strict callback shape (Node requires
  // address and family fields even on error; consumers ignore them when err is set).
  const fail = (cb: LookupCallback, err: NodeJS.ErrnoException) => cb(err, '', 0)

  return function safeLookup(
    hostname: string,
    opts: LookupOptions,
    callback: LookupCallback,
  ): void {
    const family = familyAsNumber(opts.family)
    const all = opts.all === true

    // Allowlist bypass — explicit dev escape hatch.
    // Short-circuit literal IPs in the allowlist (avoids a wasted DNS syscall
    // since the system resolver just returns the literal as-is).
    if (allowHosts.has(hostname)) {
      if (ipaddr.isValid(hostname)) {
        const ipFamily = hostname.includes(':') ? 6 : 4
        return all
          ? callback(null, [{ address: hostname, family: ipFamily }], 0)
          : callback(null, hostname, ipFamily)
      }
      if (all) {
        dnsLookup(hostname, { family, all: true as const, hints: opts.hints })
          .then((result) => callback(null, result, 0))
          .catch((err: NodeJS.ErrnoException) => fail(callback, err))
      } else {
        dnsLookup(hostname, { family, hints: opts.hints })
          .then((result) => callback(null, result.address, result.family))
          .catch((err: NodeJS.ErrnoException) => fail(callback, err))
      }
      return
    }

    // Literal IP — validate without DNS
    if (ipaddr.isValid(hostname)) {
      if (!isPublicUnicast(hostname)) {
        fail(callback, new SsrfBlockedError(hostname, `literal IP ${hostname} is not public unicast`))
        return
      }
      const ipFamily = hostname.includes(':') ? 6 : 4
      if (all) {
        callback(null, [{ address: hostname, family: ipFamily }], 0)
      } else {
        callback(null, hostname, ipFamily)
      }
      return
    }

    // Hostname — resolve ALL records and reject if ANY is non-public.
    // This is stricter than the system resolver's default (which returns
    // whichever record happened to be first) and prevents bypasses where
    // a hostname intentionally has mixed public/private records.
    dnsLookup(hostname, { all: true, family, hints: opts.hints })
      .then((addrs: LookupAddress[]) => {
        if (addrs.length === 0) {
          fail(callback, new SsrfBlockedError(hostname, `${hostname} resolved to no addresses`))
          return
        }
        const bad = addrs.find(({ address }) => !isPublicUnicast(address))
        if (bad) {
          fail(
            callback,
            new SsrfBlockedError(
              hostname,
              `${hostname} resolves to non-public address ${bad.address}`,
            ),
          )
          return
        }
        // All addresses passed validation. Honor opts.all contract.
        if (all) {
          callback(null, addrs, 0)
        } else {
          const first = addrs[0]!
          callback(null, first.address, first.family)
        }
      })
      .catch((err: NodeJS.ErrnoException) => fail(callback, err))
  }
}

/**
 * Build an undici Agent whose `connect.lookup` enforces SSRF policy at the
 * TCP-connection-establishment layer. This is the only correct place to defend
 * against DNS rebinding — validation runs synchronously with each new connection,
 * so there is no validate-then-fetch window an adversary can exploit.
 *
 * The TLS SNI and Host header continue to use the original hostname; only the
 * underlying TCP connection is pinned to a validated IP. HTTPS certificate
 * validation is unaffected.
 *
 * @param allowHosts Hostnames that bypass validation entirely (dev escape hatch).
 *                   Production code should pass an empty Set.
 */
export function createSafeAgent(allowHosts: ReadonlySet<string>): Agent {
  return new Agent({
    connect: {
      lookup: buildSafeLookup(allowHosts),
    },
  })
}
