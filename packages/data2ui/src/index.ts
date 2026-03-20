/**
 * @api2aux/data2ui — Framework-agnostic data-to-UI inference engine.
 *
 * Parses raw data (JSON, YAML, XML), infers schema and semantics,
 * selects optimal UI components, and produces a serializable UIPlan
 * descriptor tree that any renderer can consume.
 */

// --- Const enums ---
export { NodeKind, ComponentType, SelectionReason, RenderHint, InputFormat } from './types'
export type { NodeKind as NodeKindType, InputFormat as InputFormatType } from './types'

// --- Core types ---
export type { UINode, LayoutNode, FieldNode, CollectionNode, UIPlan } from './plan/types'

// --- Parsing ---
export { parseInput, detectFormat } from './parse'
export type { ParseResult, ParseOptions, XmlParseOptions } from './parse/types'

// --- Component selection ---
export {
  selectComponent,
  selectObjectComponent,
  selectPrimitiveArrayComponent,
  getDefaultTypeName,
} from './select'
export type { ComponentSelection, SelectionContext } from './select/types'

// --- Detection utilities ---
export { detectFieldType } from './detect/type'
export { isImageUrl, getHeroImageField } from './detect/image'
export {
  detectPrimitiveMode,
  isEmail,
  isColorValue,
  isRatingField,
  isCurrencyField,
  isCodeField,
} from './detect/primitive'

// --- Plugin registry ---
export { PluginRegistry } from './plugins/registry'
export type { FieldPluginDescriptor, PluginAccepts } from './plugins/types'

// --- Main entry point ---
export { buildUIPlan } from './plan/builder'
export type { BuildOptions } from './plan/types'

// --- Re-exports from semantic-analysis for consumer convenience ---
export type {
  TypeSignature,
  FieldDefinition,
  UnifiedSchema,
  SemanticMetadata,
} from '@api2aux/semantic-analysis'
export type {
  ImportanceScore,
  GroupingResult,
  AnalysisResult,
  PathAnalysis,
} from '@api2aux/semantic-analysis'
