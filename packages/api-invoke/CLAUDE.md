# Project Instructions

## Overview

api-invoke is a runtime API client library (TypeScript, MIT, v0.1.0). It parses OpenAPI 2/3 specs, GraphQL endpoints (via introspection), raw URLs, or manual definitions and executes HTTP operations. No code generation — everything happens at runtime. Outputs ESM + CJS + types via tsup.


## Git Workflow

- **Always create a new branch from main before the first commit** — no exceptions.
- Branch naming: descriptive (`feat/graphql-adapter`, `fix/cors-probe`, `docs/claude-md`).
- Do not commit directly to main.
- **Before pushing to remote**, check if the changes affect the published package (source code, types, or dependencies — i.e. anything that ends up in `dist/`). If they do, suggest a version bump and ask the user to confirm: `patch` for bug fixes, `minor` for new features (backwards compatible), `major` for breaking changes. If confirmed, run `npm version <level>` before pushing so the tag triggers the npm publish workflow. If the changes are docs-only (README, CONTRIBUTING, CLAUDE.md, etc.), just push — no version bump needed.

## Commands

| Command | When to run | What it does |
|---------|-------------|--------------|
| `pnpm test` | After every change | Unit tests (vitest, 330 tests) |
| `pnpm typecheck` | After every change | Strict TypeScript check (`tsc --noEmit`) |
| `pnpm build` | Before committing | Production build (ESM + CJS + types) |
| `pnpm test:e2e` | When touching execution/auth/middleware | E2e tests against real APIs (needs `.env`) |
| `pnpm docs` | When JSDoc changes | Regenerate TypeDoc (output in `docs/`) |

Test configs: `vitest.config.ts` (unit, excludes e2e), `vitest.e2e.config.ts` (e2e only).

## Architecture

**Data flow:** `Input (URL/object/builder) → Adapter → ParsedAPI → Executor → ExecutionResult`

**Central type:** `ParsedAPI` in `src/core/types.ts` — the normalized model all adapters produce and the executor consumes.

### Client (`src/client.ts`)
`createClient()` auto-detects input type (spec URL vs GraphQL endpoint vs raw URL vs object). `ApiInvokeClient` wraps a `ParsedAPI` with auth, middleware, and timeout.

### Adapters (each produces `ParsedAPI`)
- `src/adapters/openapi/parser.ts` — OpenAPI 2.0/3.x via `@apidevtools/swagger-parser`
  - `security.ts` — auth scheme extraction (bearer, basic, apiKey, cookie, OAuth2 metadata)
  - `base-url.ts` — server URL extraction with variable interpolation
- `src/adapters/raw/parser.ts` — raw URL(s) to single or multi-operation API
- `src/adapters/manual/builder.ts` — fluent `defineAPI()` builder
- `src/adapters/graphql/parser.ts` — GraphQL introspection → `ParsedAPI` (endpoint URL or introspection JSON)
  - `introspection.ts` — introspection query constant + TypeScript types
  - `query-builder.ts` — auto-generates depth-limited GraphQL query strings from introspection data
  - `errors.ts` — `hasGraphQLErrors`, `getGraphQLErrors`, `throwOnGraphQLErrors` (GraphQL returns 200 on errors)

### Core (spec-agnostic, `src/core/`)
- `types.ts` — all types + `as const` enum objects (`HttpMethod`, `AuthType`, `ParamLocation`, `SpecFormat`, `ContentType`, `HeaderName`). `Operation.buildBody` hook allows protocol adapters (e.g., GraphQL) to customize body construction.
- `executor.ts` — `buildRequest` (dry-run), `executeOperation`, `executeRaw`, streaming variants. Handles JSON/form-urlencoded/multipart body serialization, error classification, timeout, abort signals
- `auth.ts` — `injectAuth` (supports `Auth | Auth[]`), `refreshOAuth2Token`, `maskAuth`
- `auth-config.ts` — flat config → `Auth` union conversion (for CLI consumers)
- `url-builder.ts` — URL construction, path interpolation, query serialization (comma-separated), header/cookie param extraction, default values
- `errors.ts` — `ApiInvokeError` with `kind`/`suggestion`/`retryable`/`responseBody`. Factories: `corsError`, `networkError`, `authError`, `httpError`, `parseError`, `timeoutError`
- `sse.ts` — WHATWG-compliant SSE stream parser (async generator)

### Middleware (`src/middleware/`)

Two patterns coexist (known design inconsistency):
- **Fetch wrappers** (re-execute the request): `retry.ts` (`withRetry`), `oauth-refresh.ts` (`withOAuthRefresh`) — configured via `options.fetch`
- **Middleware objects** (intercept/transform only): `logging.ts` (`logging`), `cors-proxy.ts` (`corsProxy`) — configured via `options.middleware`, implement `{ onRequest?, onResponse?, onError? }`

## Design Patterns

- **`as const` objects for enums** — never TypeScript `enum`. Pattern: `const Foo = {...} as const; type Foo = (typeof Foo)[keyof typeof Foo]`. Use enum constants everywhere (production and tests) — never hardcode string literals for values that have a constant. Example: use `TypeKind.SCALAR` not `'SCALAR'`, `HttpMethod.POST` not `'POST'`.
- **Discriminated unions** — `Auth` is discriminated on `type` field. Each variant has different required fields.
- **Adapters are independent** — each produces `ParsedAPI`, none depends on another adapter.
- **Error classification** — all errors are `ApiInvokeError` with a `kind` from `ErrorKind`. Factory functions enforce consistency.
- **`throwOnHttpError` dual mode** — client-side errors (CORS, network, timeout) always throw. HTTP errors (4xx/5xx) are configurable.
- **Body assembly from flat args** — when no explicit `body` key is provided, executor assembles the body from flat args matching `requestBody.schema.properties`. Critical for MCP tool integration where tools pass flat key-value args.
- **`buildBody` hook for protocol adapters** — `Operation.buildBody` lets adapters customize body construction (e.g., GraphQL wraps args into `{ query, variables }`). Executor checks `buildBody` before flat-arg assembly.
- **All public APIs have JSDoc** — every exported function, class, type, and interface.

## Testing Conventions

- **Co-located tests:** `foo.ts` has a sibling `foo.test.ts` in the same directory.
- **Explicit imports:** `import { describe, it, expect, vi } from 'vitest'` in every test file.
- **Mock fetch:** create mock functions returning `new Response(body, { status, headers })`. Never make real HTTP requests in unit tests.
- **Inline fixtures:** tests create `Operation` objects inline rather than parsing specs.
- **E2e tests:** `src/e2e.test.ts` hits real APIs. Uses `it.skipIf(!key)` for graceful skipping when API keys are unavailable.
- **Coverage:** every new feature needs tests. Every bug fix needs a regression test.

## How to Add Features

### New adapter (e.g., GraphQL, AsyncAPI)
1. Create `src/adapters/<name>/parser.ts` — must return `ParsedAPI`
2. Add a new value to `SpecFormat` in `src/core/types.ts`
3. Export from `src/index.ts`
4. Add tests in `src/adapters/<name>/parser.test.ts`
5. Consider adding auto-detection in `createClient()` (`src/client.ts`)

### New middleware
1. Create `src/middleware/<name>.ts`
2. If it re-executes requests (like retry/refresh): implement as a fetch wrapper
3. If it only intercepts/transforms: implement as a `Middleware` object factory
4. Export from `src/middleware/index.ts` and `src/index.ts`
5. Add tests in `src/middleware/<name>.test.ts`

### New auth type
1. Add variant to `AuthType` in `src/core/types.ts`
2. Add variant to `Auth` union in `src/core/types.ts`
3. Add case in `injectAuth()` and `maskAuth()` in `src/core/auth.ts`
4. If spec-declared: add mapping in `src/adapters/openapi/security.ts`
5. Add tests in `src/core/auth.test.ts`

## Common Pitfalls

- **Do not set Content-Type for multipart** — fetch auto-sets it with the boundary. Setting it manually breaks uploads.
- **`throwOnHttpError` does not affect CORS/network/timeout** — those always throw regardless.
- **No body for GET/HEAD/OPTIONS** — executor excludes body even if `requestBody` is defined on the operation.
- **Query params use comma-separated style** — nested objects are not supported (only flat key-value).
- **SSE stream is single-use** — the `stream` property can only be iterated once.
- **Enricher runs after parsing, before client construction** — it receives and must return a `ParsedAPI`.
- **`.planning/` is gitignored** — planning docs are local-only, won't exist in CI or fresh clones.
- **GraphQL returns 200 on errors** — use `throwOnGraphQLErrors()` to check. Partial errors (data + errors both present) do not throw — only total failures (data is null).

## Verification

After changes:
1. `pnpm test` — no regressions
2. `pnpm typecheck` — no type errors
3. `pnpm build` — clean build
