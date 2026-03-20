/**
 * Types for component selection.
 * Stub for Phase 1; populated in Phase 2.
 */
import type { SemanticMetadata, ImportanceScore } from '@api2aux/semantic-analysis'

/** Result of component selection with confidence scoring */
export interface ComponentSelection {
  /** Component type name (e.g., 'table', 'card-list', 'gallery') */
  componentType: string
  /** Confidence score (0.0 - 1.0). Only >= 0.75 triggers smart defaults. */
  confidence: number
  /** Reason for selection */
  reason: string
}

/** Context data for component selection heuristics */
export interface SelectionContext {
  /** Field path → semantic metadata mapping */
  semantics: Map<string, SemanticMetadata>
  /** Field path → importance score mapping */
  importance: Map<string, ImportanceScore>
}
