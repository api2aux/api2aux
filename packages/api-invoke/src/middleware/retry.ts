/**
 * Retry fetch wrapper — exponential backoff with Retry-After header support.
 *
 * Works by wrapping the fetch function rather than using middleware hooks,
 * since retry logic needs to re-execute the entire request.
 */

export interface RetryOptions {
  /** Max retry attempts (default: 3) */
  maxRetries?: number
  /** Initial delay in ms (default: 1000) */
  initialDelayMs?: number
  /** Max delay in ms (default: 30000) */
  maxDelayMs?: number
  /** Backoff multiplier (default: 2) */
  multiplier?: number
  /** Jitter factor 0-1 (default: 0.1) */
  jitter?: number
  /** Which status codes to retry (default: [429, 500, 502, 503, 504]) */
  retryableStatuses?: number[]
  /** Called on each retry with attempt info */
  onRetry?: (attempt: number, delayMs: number, status?: number) => void
}

const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504]

/**
 * Parse the Retry-After header value into milliseconds.
 * Supports both delay-seconds and HTTP-date formats.
 */
function parseRetryAfter(value: string): number | undefined {
  // Try as seconds first
  const seconds = Number(value)
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000
  }

  // Try as HTTP-date
  const date = Date.parse(value)
  if (!Number.isNaN(date)) {
    const delayMs = date - Date.now()
    return delayMs > 0 ? delayMs : 0
  }

  return undefined
}

/**
 * Calculate delay with exponential backoff and jitter.
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  multiplier: number,
  maxDelayMs: number,
  jitter: number,
): number {
  const base = initialDelayMs * Math.pow(multiplier, attempt)
  const capped = Math.min(base, maxDelayMs)
  const jitterAmount = capped * jitter * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(capped + jitterAmount))
}

/**
 * Create a fetch wrapper that retries on transient failures.
 * Implements exponential backoff with jitter, and respects the `Retry-After` header.
 *
 * @param options - Retry configuration (max retries, delays, retryable statuses)
 * @param baseFetch - Base fetch function to wrap. Defaults to `globalThis.fetch`.
 * @returns A fetch-compatible function with retry behavior
 *
 * @example
 * ```ts
 * const client = await createClient(url, {
 *   fetch: withRetry({ maxRetries: 3 }),
 * })
 * ```
 *
 * @example
 * ```ts
 * // Wrap a custom fetch
 * const client = await createClient(url, {
 *   fetch: withRetry({ maxRetries: 3 }, myCustomFetch),
 * })
 * ```
 */
export function withRetry(
  options: RetryOptions = {},
  baseFetch?: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30_000,
    multiplier = 2,
    jitter = 0.1,
    retryableStatuses = DEFAULT_RETRYABLE_STATUSES,
    onRetry,
  } = options

  const fetchFn = baseFetch ?? globalThis.fetch

  return async function retryFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let lastError: Error | undefined
    let lastResponse: Response | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetchFn(input, init)

        if (retryableStatuses.includes(response.status) && attempt < maxRetries) {
          lastResponse = response

          // Check Retry-After header
          const retryAfter = response.headers.get('retry-after')
          let delayMs: number

          if (retryAfter) {
            const parsed = parseRetryAfter(retryAfter)
            delayMs = parsed !== undefined
              ? Math.min(parsed, maxDelayMs)
              : calculateDelay(attempt, initialDelayMs, multiplier, maxDelayMs, jitter)
          } else {
            delayMs = calculateDelay(attempt, initialDelayMs, multiplier, maxDelayMs, jitter)
          }

          onRetry?.(attempt + 1, delayMs, response.status)
          await sleep(delayMs)
          continue
        }

        return response
      } catch (error) {
        lastError = error as Error

        if (attempt < maxRetries) {
          const delayMs = calculateDelay(attempt, initialDelayMs, multiplier, maxDelayMs, jitter)
          onRetry?.(attempt + 1, delayMs)
          await sleep(delayMs)
          continue
        }
      }
    }

    // All retries exhausted — return last response or throw last error
    if (lastResponse) return lastResponse
    throw lastError!
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
