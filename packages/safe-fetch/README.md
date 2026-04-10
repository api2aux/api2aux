# @api2aux/safe-fetch

SSRF-safe `fetch` for Node.js. Defeats DNS rebinding by pinning each TCP connection to a pre-validated public unicast IP via undici's `Agent.connect.lookup` hook.

## Why

Most SSRF defenses use one of these patterns, all of which are broken:

1. **Validate the URL string** — misses DNS rebinding entirely. The hostname is fine; the resolved IP is the attack vector.
2. **Resolve hostname → check IP → fetch** — TOCTOU. A malicious DNS server can return public on the validation lookup and private on the actual fetch.
3. **Block specific hostnames or IP ranges by hand** — incomplete. Misses CGNAT, TEST-NET, IPv4-mapped IPv6, 6to4, the dozens of reserved ranges.

`@api2aux/safe-fetch` does it correctly:

- **Connection pinning at the TCP layer**: validation runs *during* connection establishment via undici's `connect.lookup`. There is no validate-then-fetch window.
- **`ipaddr.js` for classification**: only addresses where `range() === 'unicast'` pass. Catches everything else (private, loopback, link-local, CGNAT, multicast, broadcast, reserved, IPv4-mapped IPv6, 6to4, Teredo, etc.).
- **All-records validation**: a hostname with *any* private record is rejected — not just whichever record the resolver happened to return first.
- **Preflight URL syntax check**: catches embedded credentials, octal/hex/non-canonical IPv4 obfuscation forms (`0177.0.0.1`, `0x7f.0.0.1`, `127.1`) before any network activity.

## Install

```bash
pnpm add @api2aux/safe-fetch
# or npm install / yarn add
```

Requires Node.js ≥ 22.

## Usage

```ts
import { createSafeFetch, SsrfBlockedError } from '@api2aux/safe-fetch'

const safeFetch = createSafeFetch()

try {
  const response = await safeFetch('https://api.example.com/data')
  const data = await response.json()
} catch (err) {
  if (err instanceof SsrfBlockedError) {
    console.error('Blocked by SSRF policy:', err.reason)
    return
  }
  throw err
}
```

The returned function is signature-compatible with `globalThis.fetch`. Drop it in wherever a `fetch` is accepted:

```ts
// With @api2aux/api-invoke
import { createClient } from '@api2aux/api-invoke'
const client = await createClient(specUrl, { fetch: safeFetch })

// With @api2aux/api-invoke retry middleware
import { withRetry } from '@api2aux/api-invoke'
const retryFetch = withRetry({ maxRetries: 2 }, safeFetch)
```

## Dev escape hatch

Local development against a server on `localhost`? Use `allowHosts`:

```ts
const safeFetch = createSafeFetch({
  allowHosts: ['localhost', '127.0.0.1'],
})
```

Hosts in `allowHosts` bypass all checks. **Never set this in production.**

## API

### `createSafeFetch(options?: SafeFetchOptions): typeof fetch`

Returns a fetch function that enforces SSRF policy. Module-level singleton recommended — the underlying undici `Agent` pools connections.

### `SafeFetchOptions`

```ts
interface SafeFetchOptions {
  allowHosts?: readonly string[]
}
```

### `SsrfBlockedError`

```ts
class SsrfBlockedError extends Error {
  readonly name: 'SsrfBlockedError'
  readonly url: string
  readonly reason: string
}
```

The `name` field is a stable identifier other middleware can check (e.g. retry wrappers should not retry `SsrfBlockedError`).

### `isPublicUnicast(addr: string): boolean`

Standalone IP classifier. Returns true only for public unicast addresses.

### `preflight(input, allowHosts): URL`

Synchronous URL syntax check. Throws `SsrfBlockedError` for malformed/obfuscated URLs.

## How DNS rebinding is defeated

```
caller                           safe-fetch                          undici                       network
  │                                  │                                  │                            │
  │ safeFetch('https://api.foo')    │                                  │                            │
  ├─────────────────────────────────►│                                  │                            │
  │                                  │ preflight (sync)                 │                            │
  │                                  │ — URL parses ✓                   │                            │
  │                                  │ — protocol https ✓               │                            │
  │                                  │ — no obfuscated IPv4 ✓           │                            │
  │                                  │                                  │                            │
  │                                  │ undiciFetch(url, { dispatcher }) │                            │
  │                                  ├─────────────────────────────────►│                            │
  │                                  │                                  │ open connection            │
  │                                  │                                  │ ↓                          │
  │                                  │                                  │ connect.lookup('api.foo')  │
  │                                  │                                  │ ↓                          │
  │                                  │       OUR LOOKUP RUNS HERE       │                            │
  │                                  │       — dns.lookup all records   │                            │
  │                                  │       — ipaddr.parse each one    │                            │
  │                                  │       — reject if any non-public │                            │
  │                                  │                                  │ ↓                          │
  │                                  │                                  │ TCP connect to validated IP├──────────►
  │                                  │                                  │ TLS handshake (SNI=api.foo)│
  │                                  │                                  │ HTTP request (Host=api.foo)│
  │                                  │                                  │                            │
```

The lookup runs *as part of* the connection establishment. There is no separate "validate" step that can be bypassed by a second DNS lookup. The TCP socket is bound to the validated IP for the entire connection lifetime — DNS rebinding to a private address has nothing to attack.

TLS SNI and the HTTP `Host` header continue to use the original hostname, so HTTPS certificate validation works correctly.

## Error types

`safeFetch` throws two distinct error types. Callers can tell them apart via `instanceof`:

| Error | When | Example |
|---|---|---|
| `SsrfBlockedError` | URL blocked by SSRF policy | Private IP, non-http protocol, embedded credentials |
| `TypeError` (with `cause`) | Network/DNS failure unrelated to SSRF policy | `ENOTFOUND`, `ECONNREFUSED`, TLS errors |

```ts
try {
  await safeFetch(url)
} catch (err) {
  if (err instanceof SsrfBlockedError) {
    // Blocked by policy — do NOT retry
    console.error('SSRF blocked:', err.reason)
  } else {
    // Network error — may be transient, retry is reasonable
    console.error('Fetch failed:', err)
  }
}
```

**Note:** `SsrfBlockedError.message` redacts query strings to avoid leaking secrets in logs. The full URL (including query string) is available on `err.url` for programmatic access.

## Known limitations

- **HTTP proxies bypass connection pinning.** Don't use safe-fetch behind `ProxyAgent` unless the proxy itself enforces SSRF policy.
- **No DNS caching.** Every connection triggers a fresh `dns.lookup`. Add a TTL cache if profiling shows it's a hotspot.
- **IPv6 zone identifiers (`fe80::1%eth0`) are unsupported.**

## License

MIT
