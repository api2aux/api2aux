/**
 * Thrown when a request is blocked by SSRF protection — either at pre-flight
 * (synchronous URL syntax check) or at connection establishment (after DNS
 * resolution and IP classification).
 *
 * The `name` field is a stable identifier ("SsrfBlockedError") that other
 * middleware (e.g. retry wrappers) can use to detect SSRF blocks without
 * importing this package, avoiding wasted retries on guaranteed-fail requests.
 */
export class SsrfBlockedError extends Error {
  override readonly name = 'SsrfBlockedError'
  /** Full URL including query string — for programmatic access only. */
  readonly url: string
  readonly reason: string

  constructor(url: string, reason: string) {
    // Redact query string from the message to avoid leaking secrets (e.g. ?token=...)
    // in error logs, exception trackers, and bug reports. The full URL with query
    // string is still available on `this.url` for programmatic callers.
    const safeUrl = redactQuery(url)
    super(`SSRF blocked: ${safeUrl} — ${reason}`)
    this.url = url
    this.reason = reason
  }
}

/** Strip query string and fragment from a URL string for safe inclusion in error messages. */
function redactQuery(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    // If the URL is malformed (which is a valid case — preflight throws for bad URLs),
    // fall back to naive truncation at the first ? or #.
    const qIdx = url.indexOf('?')
    const hIdx = url.indexOf('#')
    const cutoff = qIdx >= 0 && hIdx >= 0 ? Math.min(qIdx, hIdx) : qIdx >= 0 ? qIdx : hIdx
    return cutoff >= 0 ? url.slice(0, cutoff) : url
  }
}
