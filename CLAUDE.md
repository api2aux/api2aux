# Project Instructions

## Git Workflow

- **CRITICAL: Always create a new branch from main BEFORE the first commit** — this includes milestone setup, research, planning docs, everything. No exceptions. Create the branch immediately, before writing any files.
- Branch naming: use descriptive names like `v0.4-api-authentication`, `phase-16-context-aware-components`, `fix-cors-error`, etc.
- Do not commit directly to main — all work happens on feature branches and merges via PR or user instruction.

## Browser Automation

- **Always prefer Playwright** (`mcp__playwright__*`) for browser testing and verification.
- Only fall back to Chrome (`mcp__claude-in-chrome__*`) if Playwright is unavailable.
- **Always verify UI changes in Playwright before committing.** Any change that touches components, styling, or user-facing behavior must be visually checked via Playwright MCP.

## api-invoke Usage

- `@api2aux/api-invoke` lives in `packages/api-invoke/` as a workspace package. No `pnpm link` needed — changes are reflected instantly.
- Use it for what it's designed for: parsing API specs, building/executing operations, auth injection, middleware chains, CORS proxying for API exploration.
- **Do NOT** use `api-invoke` (`executeRaw`, `executeOperation`, etc.) for simple HTTP calls (e.g., LLM chat completions). Plain `fetch()` is simpler and more appropriate. Wrapping basic requests in api-invoke's execution pipeline adds unnecessary complexity and has caused bugs (CORS issues, error re-wrapping that loses context).

## Testing

- **Always run both unit and functional tests before committing.** Use `pnpm --filter workflow-inference test`, `pnpm --filter chat-engine test`, `pnpm --filter data2ui test`, and `pnpm --filter app test` to run all tests across all packages. This includes the functional tests in `packages/workflow-inference/src/functional/` that validate against real API specs (Spotify, GitHub, Stripe, etc.).
- **Always run `pnpm -r build` before committing.** CI runs `tsc -b` (strict type-checking) then `vite build` for each package. Vitest strips types at runtime, so tests can pass while the build fails due to type errors. The build step catches discriminated union narrowing issues, cross-package type mismatches, and other errors invisible to vitest.

## Local Development

- `api-invoke` is now part of the monorepo at `packages/api-invoke/`. No symlink needed — pnpm workspace resolution handles it automatically.
