# Changelog

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
