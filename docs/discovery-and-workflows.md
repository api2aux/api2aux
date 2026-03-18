# Runtime Discovery & Workflow Inference

How api2aux discovers cross-resource relationships and builds workflows from API specs.

## Overview

There are two independent systems that find relationships between API endpoints:

1. **Static workflow inference** — analyzes the OpenAPI spec's schemas, parameters, and conventions to infer data flow between operations. Runs instantly, no network calls.
2. **Runtime discovery** — probes live GET endpoints, extracts values from responses, and cross-matches them against other endpoints' parameters. Requires live API access.

Both produce `OperationEdge` objects (source → target with bindings and confidence scores). The static edges feed the workflow engine; the runtime edges supplement them with relationships that can't be inferred from the spec alone.

## Static Workflow Inference

### Signal Functions

The inference engine runs multiple independent signal functions over the operations. Each signal looks for different evidence of a relationship:

| Signal | What it detects | Example |
|---|---|---|
| `id-pattern` | Source response has a field like `userId` and target has a `{userId}` path param | `GET /users` returns `[{id: 1}]` → `GET /users/{id}` |
| `schema-compat` | Source field type/format matches target param type/format | `string(uuid)` → `string(uuid)` |
| `rest-convention` | RESTful patterns like list→detail | `/items` → `/items/{id}` |
| `tag-proximity` | Operations share the same OpenAPI tag | Both tagged `Users` |
| `name-similarity` | Field and param names are semantically similar | `authorId` ≈ `userId` |
Each signal has a weight (0.0–1.0) that contributes to the edge's aggregate score. Only matched signals contribute.

> **Note:** `runtime-value-match` is not run by the static inference engine. It is produced externally by the runtime discovery pipeline (see below) and merged into the graph alongside the static signals.

### Edge Scoring

An edge's raw score is computed as: `bestBindingConfidence × signalWeight`. When multiple signals match the same source→target pair (including both static and runtime signals), their raw scores are summed (capped at `MAX_RAW_SCORE` = 1.5) and the edges' bindings and signals are merged. After merging, **plugin boosts** are applied — workflow pattern hints from plugins can add up to `MAX_PLUGIN_BOOST` (0.5) to matching edges. Scores are then **normalized** to the 0.0–1.0 range (divided by the maximum raw score across all edges), then filtered by `EDGE_THRESHOLD` (0.15). This means an edge confirmed by both static analysis (e.g., `id-pattern`) and runtime discovery (`runtime-value-match`) will score higher than either signal alone.

### Workflow Composition

After edges are computed, the workflow engine composes them into named workflows by detecting patterns:

| Pattern | Structure |
|---|---|
| `browse` | List → Detail (`GET /resources` → `GET /resources/{id}`) |
| `crud` | Full CRUD: create/read/update/delete on same resource |
| `search-detail` | Search with filters → Detail endpoint |
| `create-then-get` | POST creates resource → GET retrieves it with returned ID |
| `custom` | Plugin-defined |

Workflows appear in the MCP Export dialog and are used to enrich tool descriptions for AI agents.

### Related Operations in the Sidebar

The "Depends on" / "Feeds into" sections under selected endpoints come from static workflow inference. These work regardless of whether runtime discovery has been run. The `useWorkflowAnalysis` hook computes these from the operation graph and optionally incorporates runtime edges if available.

## Runtime Discovery

### Probe Selection

The probe strategy (`probeStrategy.ts`) selects which endpoints to probe within a budget. The `selectProbes` function defaults to 10, but the orchestrator (`runtimeDiscovery.ts`) overrides this to **20 probes**.

**Eligibility:**
- Only **GET** endpoints (no side effects)
- Only endpoints whose required path params can be filled from **enum** or **example** values declared in the spec
- Endpoints with unfillable required params are skipped entirely

**Scoring** (higher = probe first):
- Base: +2 for any GET
- +3 if zero required path params (list endpoints — cheapest to call)
- +1 if has response schema (more likely to return useful structure)
- +1 if >3 response fields (more values to extract)

**Diversity:** Endpoints are grouped by resource (first 2 non-param path segments, e.g. `api/classes`). Selection round-robins across groups to ensure diverse coverage — this prevents one resource's sub-endpoints from consuming the entire budget.

### Value Extraction

After probing an endpoint, the value extractor (`valueExtractor.ts`) walks the JSON response:

- **Depth:** up to 3 levels deep
- **Arrays:** samples first 5 items
- **Keeps:** strings that look like identifiers (1–50 chars, not URLs/dates/UUIDs/booleans), integers ≥ 2
- **Skips:** URLs, ISO dates, UUIDs, booleans, whitespace, floats, 0, 1 (too common)
- **Limit:** max 200 values per probe

Each probe can extract up to this many values, which are then cross-matched against other operations' parameters.

### Cross-Matching

For each probed value V from operation A, the matcher checks every other operation B's parameters:

**Target parameter filter:** Only matches against `path` params and `required` query params. Optional query params are excluded to reduce noise.

**Confidence tiers:**

| Confidence | Condition | Example |
|---|---|---|
| **0.95** | Value matches param's declared `enum` | Response `"elf"` found in `{index}` enum `["elf","dwarf","human"]` |
| **0.85** | Value matches param's `example` | Response `"elf"` matches `example: "elf"` |
| **0.80** | Value appears in target's probe response under a field with matching name (cross-probe) | Source returns `{index: "acolyte"}`, target also has `index` field with `"acolyte"` |

**Number safety:** For numeric matches below 0.90 confidence, the field name must be similar to the param name to avoid false positives (e.g., a random `3` matching an integer param).

**Raw edge score:** `bestBindingConfidence × SIGNAL_WEIGHT(0.40)`
- 0.95 × 0.40 = **0.38** (enum match)
- 0.85 × 0.40 = **0.34** (example match)
- 0.80 × 0.40 = **0.32** (cross-probe match)

These raw scores are then merged with any static signals for the same edge pair and normalized (see Edge Scoring above).

### Known Limitation: Optional Query Params

Runtime discovery only matches against path params and required query params. APIs where cross-resource data flows through **optional** query params (e.g., CROssBAR's `/activities?molecule=X`) will show 0 runtime links even though static analysis finds relationships.

This is by design — matching response values against optional query params would be very noisy (any string could match any optional filter). The static signals cover these relationships because they compare field/param names and types rather than actual values.

### Caching

Discovery results are cached in `sessionStorage` keyed by the spec's identity (title, version, baseUrl, operation count, and a fingerprint hash of operation IDs). Results persist across dialog open/close and page navigation within the same session. Changing the loaded spec clears the cache.

## Discovery Dialog UI

The Discovery Dialog (`DiscoveryDialog.tsx`) uses a tabbed layout:

- **Runtime tab** — runtime discovery controls and results, with four states:

| State | What's shown |
|---|---|
| **Idle** | Explanation text, GET endpoint count, "Start Discovery" button |
| **Running** | Progress bar, "Probing X/Y", current path being probed, Cancel button |
| **Done** | Summary line, runtime edges list (expandable with binding + signal detail), expandable Probes section (per-probe success/fail), Re-run button |
| **Error** | Error message with last progress, Retry button |

- **Static tab** — all statically-inferred edges, sorted by score descending. Each edge is expandable to show bindings and signals, using the same `EdgeRow` component as the Runtime tab.

The sidebar shows a "Discover more relations" link that opens the dialog. During active discovery, the text changes to "Discovering..." with a spinner.

## Future Improvements

- **Optional query param matching:** Explore heuristics to safely match values against optional query params (e.g., require field name similarity AND type compatibility).
- **Probe chaining:** Use values from probe A to fill params for probe B (e.g., list endpoint returns IDs, then probe detail endpoint with those IDs). Currently each probe is independent.
- **POST/mutation discovery:** Detect create→read patterns by analyzing request body schemas against response schemas without actually calling POST endpoints.
