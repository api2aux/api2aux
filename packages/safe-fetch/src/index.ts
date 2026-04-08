import { fetch as undiciFetch } from 'undici'
import { createSafeAgent } from './agent.js'
import { preflight } from './preflight.js'
import { SsrfBlockedError } from './errors.js'

export { SsrfBlockedError } from './errors.js'
export { isPublicUnicast } from './classify.js'
export { preflight } from './preflight.js'

/**
 * Configuration for {@link createSafeFetch}.
 *
 * Strict by default — pass `allowHosts` only when you genuinely need to fetch
 * from internal addresses (e.g. local dev against `localhost:3000`). Production
 * code should never set it.
 */
export interface SafeFetchOptions {
  /**
   * Hostnames that bypass SSRF validation entirely. Use only as a dev-mode
   * escape hatch — for example `['localhost', '127.0.0.1']` when running
   * against a local API server. Defaults to an empty list (strict).
   */
  allowHosts?: readonly string[]

  /**
   * Reserved for forward compatibility — accepted in v0.1 but not yet enforced.
   * Stream-level enforcement will land in a follow-up release.
   */
  maxResponseBytes?: number
}

/**
 * Create a fetch function that defends against SSRF and DNS rebinding by
 * pinning each TCP connection to a pre-validated public IP via undici's
 * `connect.lookup` hook.
 *
 * The returned function is signature-compatible with `globalThis.fetch` and
 * can be passed wherever a fetch is accepted (e.g. `@api2aux/api-invoke`'s
 * `ClientOptions.fetch`, `withRetry` base fetch, custom HTTP agents).
 *
 * Throws {@link SsrfBlockedError} synchronously for malformed URLs (preflight),
 * or asynchronously for URLs whose resolved IPs are not public unicast.
 *
 * @example
 * ```ts
 * import { createSafeFetch, SsrfBlockedError } from '@api2aux/safe-fetch'
 *
 * const safeFetch = createSafeFetch()
 *
 * try {
 *   const response = await safeFetch('https://api.example.com/data')
 *   const data = await response.json()
 * } catch (err) {
 *   if (err instanceof SsrfBlockedError) {
 *     console.error('Blocked by SSRF policy:', err.reason)
 *   }
 *   throw err
 * }
 * ```
 */
export function createSafeFetch(options: SafeFetchOptions = {}): typeof globalThis.fetch {
  const allowHosts = new Set(options.allowHosts ?? [])
  const agent = createSafeAgent(allowHosts)

  const safeFetch: typeof globalThis.fetch = async (input, init) => {
    // Synchronous URL syntax check — fast-fails on obvious garbage with clean errors
    preflight(input as string | URL | Request, allowHosts)

    try {
      // Pass the original input through so undici receives the same URL/Request
      // shape the caller intended (preserves headers, body, signal, etc.)
      const response = await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher: agent,
      })
      return response as unknown as Response
    } catch (err) {
      // undici wraps lookup errors as `TypeError: fetch failed` with cause set
      // to the original error. Unwrap so callers can `instanceof SsrfBlockedError`.
      if (err instanceof TypeError && err.cause instanceof SsrfBlockedError) {
        throw err.cause
      }
      throw err
    }
  }

  return safeFetch
}
