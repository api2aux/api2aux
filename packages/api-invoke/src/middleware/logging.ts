/**
 * Logging middleware — request/response logging with automatic secret masking.
 *
 * Masks Authorization headers, API keys in query strings, and other
 * sensitive values to prevent credential leakage in logs.
 */

import type { Middleware } from '../core/types'
import { HttpMethod } from '../core/types'

export interface LoggingOptions {
  /** Custom log function (default: console.log) */
  log?: (message: string) => void
  /** Log response bodies (default: false) */
  logBody?: boolean
  /** Additional header names to mask (always masks Authorization) */
  sensitiveHeaders?: string[]
  /** Query parameter names to mask (e.g., ['api_key', 'token']) */
  sensitiveParams?: string[]
  /** Label prefix for log messages (default: 'api-invoke') */
  prefix?: string
}

const DEFAULT_SENSITIVE_HEADERS = ['authorization', 'x-api-key', 'cookie']
const DEFAULT_SENSITIVE_PARAMS = ['api_key', 'apikey', 'key', 'token', 'access_token']

/**
 * Mask a header value, showing only the scheme for Authorization headers.
 */
function maskHeaderValue(name: string, value: string): string {
  const lower = name.toLowerCase()
  if (lower === 'authorization') {
    const space = value.indexOf(' ')
    if (space > 0) {
      return `${value.substring(0, space)} ***`
    }
    return '***'
  }
  return '***'
}

/**
 * Mask sensitive query parameters in a URL.
 */
function maskUrl(url: string, sensitiveParams: string[]): string {
  try {
    const parsed = new URL(url)
    let masked = false
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '***')
        masked = true
      }
    }
    return masked ? parsed.toString() : url
  } catch {
    return url
  }
}

/**
 * Extract and mask headers from RequestInit for logging.
 */
function formatHeaders(
  init: RequestInit,
  sensitiveHeaders: string[],
): Record<string, string> | undefined {
  const headers = init.headers
  if (!headers) return undefined

  const result: Record<string, string> = {}
  const sensitiveSet = new Set(sensitiveHeaders.map(h => h.toLowerCase()))

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = sensitiveSet.has(key.toLowerCase())
        ? maskHeaderValue(key, value)
        : value
    })
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      result[key] = sensitiveSet.has(key.toLowerCase())
        ? maskHeaderValue(key, value)
        : value
    }
  } else {
    for (const [key, value] of Object.entries(headers)) {
      result[key] = sensitiveSet.has(key.toLowerCase())
        ? maskHeaderValue(key, value)
        : value
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Create a logging middleware that logs requests and responses.
 * Automatically masks sensitive headers (Authorization, cookies) and query parameters.
 *
 * @param options - Logging configuration (custom logger, body logging, sensitive fields)
 * @returns A {@link Middleware} that logs request/response details
 *
 * @example
 * ```ts
 * const client = await createClient(url, {
 *   middleware: [logging()],
 * })
 * ```
 *
 * @example
 * ```ts
 * // Custom logger
 * const client = await createClient(url, {
 *   middleware: [logging({ log: myLogger.info })],
 * })
 * ```
 */
export function logging(options: LoggingOptions = {}): Middleware {
  const {
    log = console.log,
    logBody = false,
    prefix = 'api-invoke',
  } = options

  const sensitiveHeaders = [
    ...DEFAULT_SENSITIVE_HEADERS,
    ...(options.sensitiveHeaders ?? []).map(h => h.toLowerCase()),
  ]
  const sensitiveParams = [
    ...DEFAULT_SENSITIVE_PARAMS,
    ...(options.sensitiveParams ?? []),
  ]

  let requestStart = 0

  return {
    name: 'logging',

    onRequest(url, init) {
      requestStart = performance.now()

      const maskedUrl = maskUrl(url, sensitiveParams)
      const method = (init.method ?? HttpMethod.GET).toUpperCase()
      const headers = formatHeaders(init, sensitiveHeaders)

      const parts = [`[${prefix}] → ${method} ${maskedUrl}`]
      if (headers) {
        parts.push(`  headers: ${JSON.stringify(headers)}`)
      }
      if (logBody && init.body) {
        const bodyStr = typeof init.body === 'string' ? init.body : '<binary>'
        parts.push(`  body: ${bodyStr}`)
      }
      log(parts.join('\n'))

      return { url, init }
    },

    onResponse(response) {
      const elapsed = requestStart ? `${Math.round(performance.now() - requestStart)}ms` : '?ms'
      const status = response.status
      const statusText = response.statusText
      log(`[${prefix}] ← ${status} ${statusText} (${elapsed})`)
      return response
    },

    onError(error) {
      log(`[${prefix}] ✕ ${error.message}`)
    },
  }
}
