# Contributing to api-invoke

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Getting Started

```bash
git clone https://github.com/jorgeroa/api-invoke.git
cd api-invoke
pnpm install
pnpm build
pnpm test
```

## Development Workflow

1. **Create a branch** from `main` — always, before any commits.

   ```bash
   git checkout -b feat/my-feature main
   ```

   Use descriptive names: `feat/graphql-adapter`, `fix/cors-probe`, `docs/readme-update`.

2. **Make your changes** — keep commits focused and atomic.

3. **Verify** before pushing:

   ```bash
   pnpm test        # 365+ unit tests
   pnpm typecheck   # strict TypeScript check
   pnpm build       # ESM + CJS + types
   ```

4. **Open a pull request** against `main`.

## Code Style

- **`as const` objects for enums** — never TypeScript `enum`. Use the existing constants (`HttpMethod.GET`, not `'GET'`).
- **Co-located tests** — `foo.ts` has a sibling `foo.test.ts` in the same directory.
- **Mock fetch in unit tests** — return `new Response(body, { status, headers })`. Never make real HTTP requests.
- **Every new feature needs tests.** Every bug fix needs a regression test.
- **All public APIs have JSDoc** — every exported function, class, type, and interface.

## Project Structure

```
src/
  adapters/       # Input parsers (OpenAPI, GraphQL, raw URL, manual)
  core/           # Spec-agnostic engine (executor, auth, errors, types)
  middleware/     # Request interceptors (retry, CORS proxy, logging)
  client.ts       # Main entry point (createClient)
  index.ts        # Public exports
```

Each adapter produces a `ParsedAPI` (defined in `src/core/types.ts`), which the executor consumes. Adapters are independent — none depends on another.

## Adding Features

### New adapter

1. Create `src/adapters/<name>/parser.ts` — must return `ParsedAPI`
2. Add a value to `SpecFormat` in `src/core/types.ts`
3. Export from `src/index.ts`
4. Add tests in `src/adapters/<name>/parser.test.ts`
5. Consider auto-detection in `createClient()` (`src/client.ts`)

### New middleware

1. Create `src/middleware/<name>.ts`
2. If it re-executes requests: implement as a fetch wrapper (like `withRetry`)
3. If it only intercepts/transforms: implement as a `Middleware` object (like `logging`)
4. Export from `src/middleware/index.ts` and `src/index.ts`
5. Add tests

### New auth type

1. Add variant to `AuthType` and `Auth` union in `src/core/types.ts`
2. Add case in `injectAuth()` and `maskAuth()` in `src/core/auth.ts`
3. If spec-declared: add mapping in `src/adapters/openapi/security.ts`
4. Add tests in `src/core/auth.test.ts`

## Releasing

Releases are manual. Only maintainers publish new versions.

```bash
npm version patch   # 0.1.0 → 0.1.1 (bug fix)
npm version minor   # 0.1.0 → 0.2.0 (new feature)
npm version major   # 0.1.0 → 1.0.0 (breaking change)
git push && git push --tags
```

Pushing a `v*` tag triggers the publish workflow:
1. CI runs typecheck, build, and tests
2. npm publish with provenance (via trusted publishing — no tokens)
3. GitHub Release with auto-generated notes

## Reporting Issues

- **Bug reports** — include steps to reproduce, expected vs actual behavior, and your Node.js/pnpm version.
- **Feature requests** — describe the use case, not just the solution.
- **Security issues** — please report privately via GitHub's security advisory feature, not in public issues.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
