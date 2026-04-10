# Project Instructions

## Overview

`@api2aux/safe-fetch` is an SSRF-safe fetch implementation for Node.js (TypeScript, MIT, v0.1.0). It exposes a drop-in `fetch`-compatible function that defeats DNS rebinding by pinning each TCP connection to a pre-validated public unicast IP via undici's `Agent.connect.lookup` hook. Outputs ESM + types via tsup. Node 22+ only.

## Git Workflow

- Always create a new branch from main before the first commit.
- Branch naming: descriptive (`feat/dns-cache`, `fix/ipv6-zones`, `docs/limitations`).
- Do not commit directly to main.
- **Before pushing to remote**, check if the changes affect the published package (source code, types, or dependencies — i.e. anything that ends up in `dist/`). If they do, suggest a version bump and ask the user to confirm: `patch` for bug fixes, `minor` for new features (backwards compatible), `major` for breaking changes.

## Commands

| Command | When to run | What it does |
|---------|-------------|--------------|
| `pnpm test` | After every change | Unit + integration tests (vitest) |
| `pnpm typecheck` | After every change | Strict TypeScript check (`tsc --noEmit`) |
| `pnpm build` | Before committing | Production build (ESM + types) |

## Architecture

**Data flow:** `fetch input → preflight (sync) → undici fetch with custom dispatcher → connect.lookup (per-connection IP validation) → response or SsrfBlockedError`

### Modules

- `src/index.ts` — public API: `createSafeFetch`, `SsrfBlockedError`, `isPublicUnicast`, `preflight`. Wires the agent + preflight + outer error unwrapping into a single drop-in fetch.
- `src/agent.ts` — `createSafeAgent` returns an undici Agent; `buildSafeLookup` is the underlying lookup function (exported for unit tests).
- `src/classify.ts` — `isPublicUnicast` wraps `ipaddr.js` with a strict allowlist (only `range() === 'unicast'` passes). Rejects all reserved/private/special ranges including IPv4-mapped IPv6, 6to4, Teredo.
- `src/preflight.ts` — synchronous URL syntax check. Rejects non-http(s), embedded credentials, octal/hex/non-canonical IPv4 forms.
- `src/errors.ts` — `SsrfBlockedError` with stable `name` field.

## Design principles

- **Connection pinning is the only correct DNS rebinding defense.** Validation runs per TCP connection, after DNS resolution, before the socket is used. There is no validate-then-fetch window.
- **Strict allowlist for IP classification, not denylist.** `ipaddr.js`'s `range()` returns `unicast` only for genuinely public addresses. Anything else is rejected. New reserved ranges added by future RFCs are automatically caught.
- **Reject ALL records on multi-result hostnames.** A hostname with mixed public/private records is rejected outright. Rejecting any single bad record is more aggressive than the system resolver default.
- **Error unwrapping at the public boundary.** undici wraps lookup errors in `TypeError: fetch failed`. We unwrap so callers see `SsrfBlockedError` directly via `instanceof`.
- **Preflight is a UX optimization, not a security layer.** It catches obvious garbage with clean error messages, but the agent's `connect.lookup` is the real boundary.

## Known limitations

- **HTTP proxies bypass connection pinning.** If you route safe-fetch through `ProxyAgent`, our `lookup` doesn't run. Don't use safe-fetch behind a proxy unless the proxy itself enforces SSRF policy.
- **No DNS caching.** Every connection triggers a fresh `dns.lookup`. Add a TTL cache if profiling shows it's a hotspot.
- **IPv6 zone identifiers (`fe80::1%eth0`) are unsupported.** Not used in API spec URLs in practice.


## Testing Conventions

- **Co-located tests:** `foo.ts` has a sibling `foo.test.ts`.
- **Mock `node:dns/promises` for agent unit tests** via `vi.mock` (must hoist above the import).
- **Use a real local HTTP server** for end-to-end allowHosts tests (see `index.test.ts`).
- Never make outbound network requests in tests — use mocked DNS or local servers only.

## Verification

After changes:
1. `pnpm test` — no regressions
2. `pnpm typecheck` — no type errors
3. `pnpm build` — clean build
