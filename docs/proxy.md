# CORS Proxy

api2aux runs in the browser and makes requests to third-party APIs. Browsers block these cross-origin requests (CORS). The CORS proxy sits between the browser and the target API, forwarding requests and adding the necessary `Access-Control-Allow-Origin` header so the browser allows the response through.

## Architecture

```
Browser (app)
  │
  ├─ corsProxy middleware (api-invoke)
  │   rewrites URL → /api-proxy/{encodedUrl}
  │
  └─► Proxy server
        │
        ├─ filterProxyHeaders()   ← strip browser/transport headers
        ├─ proxyRequest()         ← forward to upstream, add CORS headers
        └─► Target API
```

There is ONE canonical implementation of the proxy logic, consumed by thin platform adapters:

| Layer | Location | Purpose |
|-------|----------|---------|
| **Shared core** | `packages/mcp-worker/src/lib/proxy-core.ts` | Platform-agnostic pure functions (web-standard `Request`/`Response`) |
| **Hono adapter** | `packages/mcp-worker/src/routes/api-proxy.ts` | Mounts the proxy as a Hono route for Node.js |
| **Client middleware** | `packages/app/src/services/api/proxy.ts` | `corsProxy()` instance that rewrites URLs to `/api-proxy/{encoded}` |

Deployment platforms (edge functions, serverless, etc.) create their own thin adapters that import from `proxy-core.ts`. The proxy logic is never duplicated.

## Shared Core API

### `filterProxyHeaders(incoming, targetOrigin, extraSkip?)`

Filters incoming request headers for proxying:

- **Strips** headers that would confuse the upstream or cause issues:
  - `host` — must reflect the target, not the proxy
  - `origin` — browser-set, meaningless to the upstream
  - `cookie` — user's cookies should not leak to third-party APIs
  - `accept-encoding` — prevents double-compression (see below)
  - `connection` — hop-by-hop header, not forwarded through proxies
- **Rewrites** `referer` to the target origin
- **Drops** non-string header values
- Accepts `extraSkip` for platform-specific headers (e.g., headers injected by edge platforms)

### `handleCorsPreflightResponse()`

Returns a `204` response with permissive CORS headers for `OPTIONS` preflight requests.

### `proxyRequest(request, targetUrl, extraSkipHeaders?)`

Encapsulates the full proxy flow:
1. Filter headers via `filterProxyHeaders`
2. Forward body for non-GET/HEAD methods
3. Fetch from upstream
4. Add `Access-Control-Allow-Origin: *` to the response
5. Return the response

## Why `accept-encoding` is stripped

When the browser sends `Accept-Encoding: br, gzip`, the upstream API may return a compressed (e.g., brotli) response body. The proxy server's `fetch` implementation typically auto-decompresses this body. If the proxy's HTTP server then re-compresses the response for the browser, the browser receives double-compressed data and fails to decode it — resulting in a `ParseError`.

Stripping `accept-encoding` from proxied requests ensures the upstream returns uncompressed data. The proxy server can then apply its own compression to the response if its HTTP layer is configured to do so.

## Running Locally

```bash
# From the monorepo root — starts both Vite dev server and mcp-worker
pnpm dev
```

This runs two processes in parallel:
- **Vite** (port 5173) — serves the app, proxies `/api-proxy/*` to mcp-worker
- **mcp-worker** (port 8787) — runs the Hono proxy route

Vite's `server.proxy` config forwards all `/api-proxy/*` requests to mcp-worker, so the app works identically whether served by Vite in dev or by a production server.

## Custom Proxy URL

For self-hosted deployments, set the `VITE_CORS_PROXY_URL` environment variable at build time:

```bash
VITE_CORS_PROXY_URL=https://my-proxy.example.com/ pnpm build
```

When set, the client middleware rewrites API URLs to `{VITE_CORS_PROXY_URL}{encodedUrl}` instead of the default `/api-proxy/{encodedUrl}`. Your custom proxy must:

1. Accept the target URL as the path (URL-encoded)
2. Forward the request to the target with appropriate header filtering
3. Add `Access-Control-Allow-Origin: *` to the response

You can use `proxy-core.ts` functions (`filterProxyHeaders`, `proxyRequest`) in your custom proxy to get the same behavior.

The `corsProxy()` middleware from `api-invoke` also supports `shouldProxy` to selectively bypass the proxy for certain URLs:

```typescript
import { corsProxy } from 'api-invoke'

const proxy = corsProxy({
  rewrite: (url) => `https://my-proxy.com/${encodeURIComponent(url)}`,
  shouldProxy: (url) => !url.startsWith('https://trusted-api.com'),
})
```

## Adding a New Deployment Platform

To add a proxy adapter for a new platform:

1. Create a thin wrapper that imports `proxyRequest` and `handleCorsPreflightResponse` from `proxy-core.ts`
2. Extract the target URL from the platform's request format
3. Pass any platform-specific headers to strip via the `extraSkipHeaders` parameter
4. Call `proxyRequest()` and return the result

Example skeleton:

```typescript
import { proxyRequest, handleCorsPreflightResponse } from '<path-to>/proxy-core'

// Platform-specific headers to strip (in addition to the base set)
const PLATFORM_SKIP_HEADERS = new Set(['x-platform-request-id', 'x-forwarded-for'])

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return handleCorsPreflightResponse()

  const url = new URL(request.url)
  const targetUrl = decodeURIComponent(url.pathname.replace('/api-proxy/', ''))

  if (!targetUrl.startsWith('http')) {
    return new Response('Missing or invalid target URL', { status: 400 })
  }

  return proxyRequest(request, targetUrl, PLATFORM_SKIP_HEADERS)
}
```
