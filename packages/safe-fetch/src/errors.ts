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
  readonly url: string
  readonly reason: string

  constructor(url: string, reason: string) {
    super(`SSRF blocked: ${url} — ${reason}`)
    this.url = url
    this.reason = reason
  }
}
