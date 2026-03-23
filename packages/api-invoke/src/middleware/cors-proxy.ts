/**
 * CORS proxy middleware — rewrites request URLs through a proxy.
 *
 * Useful when APIs block browser CORS requests. Supports custom
 * proxy URL patterns or the common `/api-proxy/{encodedUrl}` convention.
 */

import type { Middleware } from '../core/types'

export interface CorsProxyOptions {
  /**
   * URL rewrite function. Receives the original URL, returns the proxied URL.
   * Default: `/api-proxy/{encodeURIComponent(url)}`
   */
  rewrite?: (url: string) => string

  /**
   * Only proxy URLs matching this predicate.
   * Default: proxies all absolute HTTP(S) URLs.
   */
  shouldProxy?: (url: string) => boolean
}

function defaultRewrite(url: string): string {
  return `/api-proxy/${encodeURIComponent(url)}`
}

function defaultShouldProxy(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

/**
 * Create a CORS proxy middleware that rewrites request URLs through a proxy server.
 * Useful when APIs block browser CORS requests.
 *
 * @param options - Proxy configuration (custom rewrite function, proxy filter)
 * @returns A {@link Middleware} that rewrites URLs through the proxy
 *
 * @example
 * ```ts
 * // Default: rewrites to /api-proxy/{encodedUrl}
 * const client = await createClient(url, {
 *   middleware: [corsProxy()],
 * })
 * ```
 *
 * @example
 * ```ts
 * // Custom proxy URL
 * const client = await createClient(url, {
 *   middleware: [corsProxy({
 *     rewrite: (url) => `https://my-proxy.com/?url=${encodeURIComponent(url)}`,
 *   })],
 * })
 * ```
 */
export function corsProxy(options: CorsProxyOptions = {}): Middleware {
  const rewrite = options.rewrite ?? defaultRewrite
  const shouldProxy = options.shouldProxy ?? defaultShouldProxy

  return {
    name: 'cors-proxy',
    onRequest(url, init) {
      if (shouldProxy(url)) {
        return { url: rewrite(url), init }
      }
      return { url, init }
    },
  }
}
