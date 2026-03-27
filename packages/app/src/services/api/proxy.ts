import { corsProxy } from '@api2aux/api-invoke'

/**
 * Shared CORS proxy middleware instance.
 *
 * By default, proxies through the same-origin `/api-proxy/{encodedUrl}` endpoint
 * (requires an external CORS proxy server, e.g. api2aux-platform).
 *
 * For self-hosted deployments, set `VITE_CORS_PROXY_URL` at build time to point
 * to a custom proxy:
 *
 * ```bash
 * VITE_CORS_PROXY_URL=https://my-proxy.example.com/ pnpm build
 * ```
 */
const proxyBaseUrl = import.meta.env.VITE_CORS_PROXY_URL || ''

export const proxy = corsProxy(proxyBaseUrl ? {
  rewrite: (url) => `${proxyBaseUrl}${encodeURIComponent(url)}`,
} : undefined)
