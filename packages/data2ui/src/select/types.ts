/**
 * Types for component selection.
 */
import type { SemanticMetadata, ImportanceScore } from '@api2aux/semantic-analysis'
import type { ComponentType, SelectionReason } from '../types'

/** Result of component selection with confidence scoring */
export interface ComponentSelection {
  /** Component type name (e.g., 'table', 'card-list', 'gallery') */
  componentType: ComponentType | (string & {})
  /** Confidence score (0.0 - 1.0). Only >= SMART_DEFAULT_THRESHOLD triggers smart defaults. */
  confidence: number
  /** Reason for selection */
  reason: SelectionReason | (string & {})
}

/** Context data for component selection heuristics */
export interface SelectionContext {
  /** Field path → semantic metadata mapping */
  semantics: Map<string, SemanticMetadata>
  /** Field path → importance score mapping */
  importance: Map<string, ImportanceScore>
}
