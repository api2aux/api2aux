# Local Development

## Prerequisites

- **Node.js** >= 20 (tested with v22)
- **pnpm** >= 9 (tested with v10)

## Repository structure

```
apiglot/
├── api-invoke/          # Separate repo — API spec parser, operation executor, auth injection
└── api2aux/             # This monorepo
    ├── packages/
    │   ├── app/             # React frontend (Vite)
    │   ├── chat-engine/     # LLM chat engine (pluggable, UI-independent)
    │   ├── mcp-server/      # MCP tool definitions
    │   ├── semantic-analysis/  # Field-level semantic enrichment
    │   ├── workflow-inference/ # Endpoint relation detection (static + runtime)
    │   ├── tool-definition-builder/      # Shared utilities for tool/operation conversion
    │   └── api-catalog/     # API catalog with admin tools
    ├── data/                # APIs CSV, test fixtures
    └── docs/                # This folder
```

## Quick start

```bash
# 1. Clone both repos side by side
git clone <api2aux-repo> apiglot/api2aux
git clone <api-invoke-repo> apiglot/api-invoke

# 2. Install api-invoke dependencies
cd apiglot/api-invoke
pnpm install

# 3. Install api2aux dependencies
cd ../api2aux
pnpm install

# 4. Link local api-invoke (symlink, edits reflect instantly)
pnpm link ../api-invoke

# 5. Build all packages (needed for cross-package imports)
pnpm run build

# 6. Start dev servers
pnpm run dev
# → App:        http://localhost:5173
```

## The `api-invoke` link

`api-invoke` is a separate package that handles API spec parsing, operation building/execution, auth injection, and CORS proxying. The monorepo depends on it via npm (`"api-invoke": "^0.2.1"`), but for local development you want the symlinked version so changes are reflected instantly.

### How it works

`pnpm link ../api-invoke` creates a symlink from `api2aux/node_modules/api-invoke` → `api-invoke/`. This means:

- Edits to `api-invoke/src/` are picked up after rebuilding (`pnpm run build` in api-invoke)
- `api-invoke/dist/` is what gets imported — you need to rebuild after source changes

### Common issue: missing transitive dependencies

When Node resolves imports from `api-invoke/dist/index.js`, it looks for dependencies in `api-invoke/node_modules/`, **not** in `api2aux/node_modules/`. If `api-invoke/node_modules/` is missing or incomplete, you'll see errors like:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@apidevtools/swagger-parser'
imported from /Users/.../api-invoke/dist/index.js
```

**Fix:** Run `pnpm install` inside the `api-invoke` directory:

```bash
cd apiglot/api-invoke
pnpm install
```

### After every `pnpm install`

Running `pnpm install` in `api2aux` can remove the symlink. Re-link afterwards:

```bash
pnpm link ../api-invoke
```

## Available scripts

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start app dev server (Vite) |
| `pnpm run build` | Build all packages |
| `pnpm run test` | Run tests across all packages (watch mode) |
| `pnpm run test:run` | Run tests once (CI mode) |
| `pnpm run lint` | Lint all packages |

### Per-package commands

```bash
# Build a specific package
pnpm --filter @api2aux/chat-engine build

# Run tests for a specific package
pnpm --filter @api2aux/workflow-inference test

# Run only functional tests
pnpm --filter @api2aux/chat-engine test -- --testPathPattern=functional
```

## Package dependency graph

```
app
├── chat-engine
│   ├── semantic-analysis
│   ├── workflow-inference
│   └── tool-definition-builder
├── semantic-analysis
├── workflow-inference
├── tool-definition-builder
└── api-invoke (workspace)
```

Internal packages use `workspace:*` protocol. Changes to a dependency package require rebuilding it before the consuming package sees the update (or use the Vite dev server which handles this via HMR for the app).

## Dev server notes

- **Vite re-optimization**: After lockfile changes (adding packages, linking), Vite will log `Re-optimizing dependencies because lockfile has changed`. This is a one-time operation, normal.
## Environment variables

The app uses client-side API keys entered in the UI (stored in localStorage). No `.env` file is required for basic local development.

For running live API tests in chat-engine:

```bash
# Skip live tests (default in CI)
SKIP_LIVE_TESTS=1 pnpm --filter @api2aux/chat-engine test:run
```
