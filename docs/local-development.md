# Local Development

## Prerequisites

- **Node.js** >= 20 (tested with v22)
- **pnpm** >= 9 (tested with v10)

## Repository structure

```
api2aux/
├── packages/
│   ├── api-invoke/           # API spec parser, operation executor, auth injection
│   ├── app/                  # React frontend (Vite)
│   ├── chat-engine/          # LLM chat engine (pluggable, UI-independent)
│   ├── cors-proxy/           # Platform-agnostic CORS proxy core
│   ├── data2ui/              # Data-to-UI inference engine
│   ├── mcp-server/           # MCP tool definitions (CLI)
│   ├── semantic-analysis/    # Field-level semantic enrichment
│   ├── tool-definition-builder/ # Shared tool name/description generation
│   └── workflow-inference/   # Endpoint relation detection (static + runtime)
├── data/                     # APIs CSV, test fixtures
└── docs/                     # This folder
```

## Quick start

```bash
git clone <api2aux-repo>
cd api2aux
pnpm install
pnpm run build    # needed for cross-package imports
pnpm run dev
# → App: http://localhost:5173
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
├── api-invoke (workspace)
├── chat-engine
│   ├── semantic-analysis
│   ├── workflow-inference
│   └── tool-definition-builder
├── data2ui
├── semantic-analysis
├── workflow-inference
└── tool-definition-builder
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
