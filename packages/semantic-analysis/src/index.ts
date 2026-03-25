/**
 * @api2aux/semantic-analysis
 *
 * Pure TypeScript semantic analysis engine for API responses.
 * Detects field categories (price, email, rating, etc.), calculates importance,
 * infers schemas, and parses OpenAPI specs.
 *
 * Zero React dependencies — works in Node.js, browser, or any TS environment.
 */

// === Semantic Detection ===
export {
  detectSemantics,
  detectCompositeSemantics,
  getBestMatch,
  clearSemanticCache,
  setCustomCategoriesProvider,
  getAllPatterns,
  getCompositePatterns,
  getPattern,
  isCompositePattern,
  DEFAULT_THRESHOLDS,
} from './semantic'

export type {
  SemanticCategory,
  ConfidenceLevel,
  ConfidenceResult,
  SignalMatch,
  SemanticPattern,
  CompositePattern,
  NamePattern,
  TypeConstraint,
  ValueValidator,
  FormatHint,
  SemanticMetadata,
} from './semantic'

// === Schema Inference ===
export { inferSchema } from './schema/inferrer'
export { getDefaultComponent, mapToComponents } from './schema/mapper'
export { detectFieldType } from './schema/typeDetection'

// === Field Analysis ===
export {
  analyzeFields,
  calculateImportance,
  isMetadataField,
  detectPrefixGroups,
  detectSemanticClusters,
  analyzeGrouping,
  ANALYSIS_CONFIG,
  IMPORTANCE_CONFIG,
  GROUPING_CONFIG,
} from './analysis'

export type {
  ImportanceTier,
  ImportanceScore,
  ImportanceSignalMatch,
  FieldInfo,
  GroupingResult,
  FieldGroup,
  PrefixGroup,
  SemanticCluster,
  AnalysisResult,
} from './analysis'

// === OpenAPI Parsing ===
export { parseOpenAPISpec } from './openapi/parser'

export type {
  ParsedAPI,
  Operation,
  Parameter,
  ParameterSchema,
  RequestBody,
  RequestBodySchema,
  RequestBodyProperty,
  AuthScheme,
  Auth,
  AuthConfig,
  ExecutionResult,
  BuiltRequest,
  SSEEvent,
  StreamingExecutionResult,
  ResultErrorKind,
  Middleware,
  Enricher,
  ClientOptions,
} from '@api2aux/api-invoke'

export {
  AuthConfigType,
  ParamLocation,
  HttpMethod,
  AuthType as ApiInvokeAuthType,
  ContentType,
  HeaderName,
  SpecFormat,
  ErrorKind,
} from '@api2aux/api-invoke'

// === Shared Types ===
export { FieldType, Confidence } from './types/schema'
export type {
  TypeSignature,
  FieldDefinition,
  UnifiedSchema,
} from './types/schema'

export { AuthType, AuthStatus } from './types/auth'
export type {
  Credential,
  BearerCredential,
  BasicCredential,
  ApiKeyCredential,
  QueryParamCredential,
  ApiCredentials,
} from './types/auth'

export { ComponentType } from './types/components'
export type {
  ComponentMapping,
  RendererProps,
} from './types/components'

export type {
  PluginSemanticCategory,
  FieldContext,
} from './types/plugins'

export type {
  DomainSignature,
  EnrichmentPlugin,
  OperationContext,
  OperationContextParam,
  OperationSemanticTag,
  ToolEnrichmentHint,
  UIComponentHint,
  WorkflowPatternHint,
  WorkflowPatternStep,
  AmbiguousMatch,
  DisambiguationResult,
} from './types/enrichment'

// === Enrichment Registry ===
export { EnrichmentPluginRegistry, enrichmentRegistry } from './enrichment/registry'
export { composeEnrichmentPlugin } from './enrichment/compose'

// === Orchestrator ===
export { analyzeApiResponse, analyzeSchema } from './orchestrator'
export type { PathAnalysis, ApiAnalysisResult } from './orchestrator'
