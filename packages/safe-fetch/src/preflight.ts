import ipaddr from 'ipaddr.js'
import { SsrfBlockedError } from './errors.js'
import { isPublicUnicast } from './classify.js'

/**
 * Synchronous URL validation. Catches obvious problems with clean error messages
 * before any network activity, AND enforces IP classification for literal-IP
 * URLs (which undici does NOT route through `connect.lookup`).
 *
 * Pre-flight is load-bearing for literal-IP URLs because undici's `connect.lookup`
 * hook is only called for hostname-based URLs — literal IPs (`http://127.0.0.1/`,
 * `http://[::1]/`) skip the resolver entirely. Without pre-flight classification
 * here, the agent's defense would not apply to them.
 *
 * Rejects:
 * - Invalid URL strings
 * - Non-http(s) protocols (file://, ftp://, javascript:, data:)
 * - Empty hostnames
 * - Embedded credentials (http://user:pass@host/)
 * - Literal IP hostnames (IPv4 or IPv6) that are not public unicast
 *
 * Note: Obfuscated IPv4 forms (`0177.0.0.1`, `0x7f.0.0.1`, `127.1`, single-integer
 * `2130706433`) are normalized to dotted-quad by Node's WHATWG URL parser BEFORE
 * preflight runs. The canonical form is then caught by the literal-IP check below.
 *
 * @param input The URL to validate (string, URL instance, or Request).
 * @param allowHosts Hostnames that bypass all checks (dev escape hatch).
 * @returns The parsed URL when validation succeeds.
 * @throws {SsrfBlockedError} If the URL is malformed, syntactically forbidden,
 *                            or its literal IP is not public unicast.
 */
export function preflight(input: string | URL | Request, allowHosts: ReadonlySet<string>): URL {
  const urlString =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    throw new SsrfBlockedError(urlString, 'invalid URL')
  }

  // Allowlist bypass — explicit dev escape hatch
  if (allowHosts.has(url.hostname)) {
    return url
  }

  // Protocol allowlist — no file://, ftp://, javascript:, data:, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(urlString, `protocol "${url.protocol}" is not allowed (only http/https)`)
  }

  if (!url.hostname) {
    throw new SsrfBlockedError(urlString, 'empty hostname')
  }

  // Embedded credentials are a phishing vector and rarely legitimate server-side.
  if (url.username || url.password) {
    throw new SsrfBlockedError(urlString, 'URLs with embedded credentials are not allowed')
  }

  // Literal IP classification — load-bearing because undici skips the lookup
  // hook for literal IPs. Strip IPv6 brackets first; ipaddr.isValid wants the
  // bare address form.
  const bareHost = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
  if (ipaddr.isValid(bareHost)) {
    if (!isPublicUnicast(bareHost)) {
      throw new SsrfBlockedError(urlString, `literal IP ${bareHost} is not public unicast`)
    }
  }

  return url
}
