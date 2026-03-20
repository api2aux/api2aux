/**
 * Core types for the UI descriptor tree.
 */
import type { NodeKind, InputFormat } from '../types'
import type {
  TypeSignature,
  UnifiedSchema,
  SemanticMetadata,
  ImportanceScore,
  GroupingResult,
  PathAnalysis,
} from '@api2aux/semantic-analysis'
import type { ComponentSelection } from '../select/types'
import type { XmlParseOptions } from '../parse/types'
import type { PluginRegistry } from '../plugins/registry'

// ---------------------------------------------------------------------------
// UINode — discriminated union for the descriptor tree
// ---------------------------------------------------------------------------

/** A node in the UI descriptor tree */
export type UINode = LayoutNode | FieldNode | CollectionNode

/** Layout-level node (renders arrays/objects) */
export interface LayoutNode {
  kind: typeof NodeKind.Layout
  /** Selected component type — open string for extensibility */
  component: string
  /** Selection metadata (confidence, reason) */
  selection: ComponentSelection
  /** JSON path to this node's data */
  path: string
  /** Inferred type signature */
  schema: TypeSignature
  /** Child descriptors */
  children: UINode[]
  /** Importance scores for child fields */
  importance: Map<string, ImportanceScore>
  /** Semantic metadata for child fields */
  semantics: Map<string, SemanticMetadata>
  /** Grouping analysis result */
  grouping: GroupingResult | null
}

/** Field-level node (renders a single value) */
export interface FieldNode {
  kind: typeof NodeKind.Field
  /** Field name */
  name: string
  /** JSON path */
  path: string
  /** Resolved plugin ID (e.g., 'core/star-rating') or null for default */
  pluginId: string | null
  /** Fallback render hint — open string for extensibility */
  renderHint: string | null
  /** Inferred type signature */
  schema: TypeSignature
  /** Semantic metadata */
  semantics: SemanticMetadata | null
  /** Importance score */
  importance: ImportanceScore | null
}

/** Collection node (primitive arrays) */
export interface CollectionNode {
  kind: typeof NodeKind.Collection
  /** Selected component type — open string for extensibility */
  component: string
  /** Selection metadata */
  selection: ComponentSelection
  /** JSON path */
  path: string
  /** Inferred type signature */
  schema: TypeSignature
  /** Semantic metadata */
  semantics: SemanticMetadata | null
}

// ---------------------------------------------------------------------------
// UIPlan — top-level output
// ---------------------------------------------------------------------------

/** The complete UI plan for a data payload */
export interface UIPlan {
  /** Root UI node */
  root: UINode
  /** Inferred schema */
  schema: UnifiedSchema
  /** Detected input format */
  inputFormat: InputFormat
  /** Per-path analysis results from semantic-analysis */
  analysis: Record<string, PathAnalysis>
  /** Generation timestamp */
  generatedAt: number
}

// ---------------------------------------------------------------------------
// BuildOptions
// ---------------------------------------------------------------------------

/** Options for buildUIPlan() */
export interface BuildOptions {
  /** Source URL (for schema metadata) */
  url?: string
  /** Force a specific input format (auto-detected if omitted) */
  inputFormat?: InputFormat
  /** XML-specific parsing options */
  xmlOptions?: Partial<XmlParseOptions>
  /** Component type overrides by JSON path */
  componentOverrides?: Record<string, string>
  /** Plugin registry for field plugin resolution */
  pluginRegistry?: PluginRegistry
  /** Plugin preferences: semantic category → preferred plugin ID */
  pluginPreferences?: Record<string, string>
}
