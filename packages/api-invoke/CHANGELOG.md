# Changelog

## 0.3.0 (2026-04-08)

### Added

- **`parseOpenAPISpec` accepts an optional `fetch` option** that is forwarded to SwaggerParser as a `resolve.http.read` resolver. This routes spec downloads AND external `$ref` resolution through the caller's HTTP client. Use case: composing with `@api2aux/safe-fetch` to get DNS-rebinding-safe spec parsing. Without this, SwaggerParser's built-in HTTP resolver bypassed any caller-supplied fetch.
- `client.ts` now forwards `options.fetch` to `parseOpenAPISpec` at every call site (`fetchAndParseSpec`, `tryContentDetection`, and the direct-object branch). A single `createClient(url, { fetch })` call now covers spec download AND `$ref` resolution.

### Notes

- Non-breaking: the new `fetch` option is optional. Default behavior is unchanged.
- No new dependencies. No new public types. Browser bundle is unaffected.

## 0.1.0 (2026-03-14)

Initial release.

- **OpenAPI 2/3 parsing** via `@apidevtools/swagger-parser` with auth scheme extraction and server URL resolution
- **GraphQL introspection** with auto-generated depth-limited queries and `buildBody` hook
- **Raw URL and manual endpoint** adapters
- **Runtime execution** — `executeOperation`, `executeRaw`, streaming variants (SSE)
- **Auth injection** — bearer, basic, API key (header/query/cookie), OAuth2 refresh
- **Middleware** — retry, CORS proxy, logging, OAuth refresh
- **Error classification** — typed `ApiInvokeError` with `ErrorKind`, suggestions, retryable flag
- **Dual output** — ESM + CJS + TypeScript declarations
