/**
 * Enrichment plugin types for multi-level semantic enrichment.
 * Pure TypeScript, no React — works in Node.js, browser, or any TS environment.
 *
 * EnrichmentPlugin is the core extension point. A single plugin can provide:
 * - Field-level detection (custom semantic categories)
 * - Operation-level tagging (semantic labels on endpoints)
 * - Tool enrichment (hints for MCP/LLM tool descriptions)
 * - UI component hints (suggest renderers for fields)
 * - Workflow patterns (domain-specific endpoint chain shapes)
 * - LLM disambiguation (refine ambiguous matches)
 *
 * All hooks are optional — a plugin implements only what it needs.
 */

import type { PluginSemanticCategory } from './plugins'

// === Operation Context ===

/** Normalized view of an API operation for enrichment hooks. */
export interface OperationContext {
  /** Operation identifier (from operationId or generated). */
  id: string
  /** URL path template (e.g. '/users/{userId}'). */
  path: string
  /** HTTP method (e.g. 'GET', 'POST'). */
  method: string
  /** Grouping tags from the spec. */
  tags: string[]
  /** Parameters with basic type info. */
  parameters: OperationContextParam[]
  /** Top-level field names from the primary response schema. */
  responseFieldNames: string[]
  /** Short summary from the spec. */
  summary?: string
  /** Longer description from the spec. */
  description?: string
}

/** Simplified parameter for enrichment hooks. */
export interface OperationContextParam {
  /** Parameter name. */
  name: string
  /** Where the parameter appears: 'path', 'query', 'header', 'cookie'. */
  in: string
  /** Data type (e.g. 'string', 'integer'). */
  type: string
  /** Format hint (e.g. 'uuid', 'date-time'). */
  format?: string
  /** Whether the parameter is required. */
  required: boolean
}

// === Operation Tags ===

/** Semantic tag applied to an operation by an enrichment plugin. */
export interface OperationSemanticTag {
  /** Tag identifier, e.g. 'commerce:checkout', 'auth:login'. */
  id: string
  /** Human-readable label, e.g. 'Checkout'. */
  label: string
  /** Confidence score (0.0-1.0). */
  confidence: number
}

// === Tool Enrichment ===

/** Hints for improving MCP/LLM tool descriptions. */
export interface ToolEnrichmentHint {
  /** Additional text appended to the tool description. */
  descriptionSuffix?: string
  /** Per-parameter hint text (paramName → hint). */
  parameterHints?: Record<string, string>
  /** Suggested parameter defaults/examples from domain knowledge. */
  parameterDefaults?: Record<string, unknown>
  /** Usage priority: higher values are suggested first (0.0-1.0). */
  priority?: number
}

// === UI Component Hints ===

/** Hint for which UI component to use for a field. */
export interface UIComponentHint {
  /** Field path pattern (glob-like, e.g. '*.price', '$.items[].thumbnail'). */
  fieldPattern: string
  /** Suggested component type or plugin ID. */
  suggestedComponent: string
  /** Confidence score (0.0-1.0). */
  confidence: number
}

// === Workflow Patterns ===

/** Domain-specific workflow pattern for boosting endpoint chain inference. */
export interface WorkflowPatternHint {
  /** Pattern name, e.g. 'add-to-cart-flow'. */
  name: string
  /** Human-readable description of the workflow's purpose. */
  description?: string
  /** Steps as operation ID patterns (regex or string glob). */
  steps: WorkflowPatternStep[]
  /** Edge weight boost applied when matched operations appear together (0.0-1.0). */
  edgeWeightBoost: number
}

/** A single step within a workflow pattern hint. */
export interface WorkflowPatternStep {
  /** Regex or string pattern to match operation IDs. */
  operationPattern: string | RegExp
  /** Role of this step in the workflow, e.g. 'browse', 'action', 'complete'. */
  role: string
}

// === LLM Disambiguation ===

/** An ambiguous match that could benefit from LLM disambiguation. */
export interface AmbiguousMatch {
  /** Source operation ID. */
  sourceOperationId: string
  /** Target operation ID. */
  targetOperationId: string
  /** Source field name that might chain to target. */
  sourceField: string
  /** Target parameter name. */
  targetParam: string
  /** Current confidence score (typically 0.4-0.7). */
  currentScore: number
  /** Context string describing the ambiguity. */
  context: string
}

/** Result of LLM disambiguation for an ambiguous match. */
export interface DisambiguationResult {
  /** Source operation ID. */
  sourceOperationId: string
  /** Target operation ID. */
  targetOperationId: string
  /** Refined confidence score after disambiguation (0.0-1.0). */
  refinedScore: number
  /** Whether the LLM confirmed this is a valid chain. */
  confirmed: boolean
  /** Optional explanation from the LLM. */
  reasoning?: string
}

// === Enrichment Plugin ===

/**
 * Core enrichment plugin interface.
 *
 * This is the extension point for adding domain-specific intelligence to apiglot.
 * A plugin implements whichever hooks it needs — all are optional except `id`, `name`, and `version`.
 *
 * Plugins are distributed as npm packages and loaded via dynamic import.
 * Convention: packages export `enrichmentPlugin: EnrichmentPlugin`.
 *
 * @example
 * ```typescript
 * export const enrichmentPlugin: EnrichmentPlugin = {
 *   id: '@commerce/basic',
 *   name: 'Commerce Enrichment',
 *   version: '1.0.0',
 *   fieldCategories: [{ id: '@commerce/sku', ... }],
 *   tagOperations: (ops) => ops.map(op => ...),
 *   workflowPatterns: () => [{ name: 'checkout-flow', ... }],
 * }
 * ```
 */
export interface EnrichmentPlugin {
  /** Unique namespaced ID, e.g. '@commerce/shopify', '@geo/mapbox'. */
  readonly id: string
  /** Human-readable name, e.g. 'Commerce Enrichment'. */
  readonly name: string
  /** SemVer version string, e.g. '1.0.0'. */
  readonly version: string

  // --- Field-level hooks (extends existing PluginSemanticCategory) ---

  /** Custom semantic categories for field detection. Feeds into the scoring pipeline. */
  fieldCategories?: PluginSemanticCategory[]

  // --- Operation-level hooks ---

  /**
   * Tag operations with semantic labels.
   * Returns an array parallel to the input: each element is the tags for that operation.
   */
  tagOperations?: (operations: OperationContext[]) => OperationSemanticTag[][]

  // --- Tool enrichment hooks ---

  /**
   * Produce hints that enrich MCP/LLM tool descriptions.
   * Returns a map of operationId → hints.
   */
  enrichTools?: (operations: OperationContext[]) => Map<string, ToolEnrichmentHint>

  // --- UI component hooks ---

  /** Produce field-level UI component suggestions. */
  uiHints?: (operations: OperationContext[]) => UIComponentHint[]

  // --- Workflow hooks ---

  /** Domain-specific workflow patterns that boost inference edge weights. */
  workflowPatterns?: () => WorkflowPatternHint[]

  // --- LLM disambiguation hooks ---

  /**
   * Refine ambiguous matches using an LLM or other advanced technique.
   * Called only for edges scoring 0.4-0.7 (the ambiguous zone).
   * Optional — noop by default.
   */
  disambiguate?: (ambiguous: AmbiguousMatch[]) => Promise<DisambiguationResult[]>
}
