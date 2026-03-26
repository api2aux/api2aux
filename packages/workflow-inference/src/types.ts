/**
 * Core types for the workflow inference engine.
 * Defines operations, edges, graphs, and workflows.
 */

// === Inference Operations ===

/** Normalized operation view for relationship inference. */
export interface InferenceOperation {
  /** Operation identifier (from operationId or generated). */
  id: string
  /** URL path template (e.g. '/users/{userId}'). */
  path: string
  /** HTTP method. */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  /** Grouping tags from the spec. */
  tags: string[]
  /** Short summary from the spec. */
  summary?: string
  /** Input parameters. */
  parameters: InferenceParam[]
  /** Top-level response fields (extracted from response schema). */
  responseFields: InferenceField[]
  /** Top-level request body fields (extracted from requestBody schema). */
  requestBodyFields: InferenceField[]
}

/** Valid parameter locations. */
export type ParamIn = 'path' | 'query' | 'header' | 'cookie' | 'body'

/** A parameter of an inference operation. */
export interface InferenceParam {
  /** Parameter name. */
  name: string
  /** Where the parameter appears. */
  in: ParamIn
  /** Data type (e.g. 'string', 'integer'). */
  type: string
  /** Format hint (e.g. 'uuid', 'date-time'). */
  format?: string
  /** Whether the parameter is required. */
  required: boolean
  /** Allowed values from the spec (e.g. enum constraint). */
  enum?: (string | number)[]
  /** Example value from the spec. */
  example?: string | number
}

/** A field extracted from a response or request body schema. */
export interface InferenceField {
  /** Field name (e.g. 'userId'). */
  name: string
  /** Data type (e.g. 'string', 'integer'). */
  type: string
  /** Format hint (e.g. 'uuid', 'date-time'). */
  format?: string
  /** JSON path within the response/request body. */
  path: string
}

// === Signal Names ===

/** Built-in signal identifiers. Custom plugins use their own string IDs. */
export const BuiltInSignal = {
  IdPattern: 'id-pattern',
  RestConventions: 'rest-convention',
  SchemaCompat: 'schema-compat',
  TagProximity: 'tag-proximity',
  NameSimilarity: 'name-similarity',
  RuntimeValueMatch: 'runtime-value-match',
  PluginBoost: 'plugin-boost',
  LlmDisambiguation: 'llm-disambiguation',
} as const
export type BuiltInSignal = typeof BuiltInSignal[keyof typeof BuiltInSignal]

// === Graph ===

/** A directed edge in the operations graph. */
export interface OperationEdge {
  /** Source operation ID (produces data). */
  sourceId: string
  /** Target operation ID (consumes data). */
  targetId: string
  /** How data flows: which source fields map to which target params. */
  bindings: DataBinding[]
  /** Aggregate confidence score (0.0-1.0). */
  score: number
  /** Individual signal contributions. */
  signals: EdgeSignal[]
}

/** A data binding between a source field and a target parameter. */
export interface DataBinding {
  /** Field path in source response. */
  sourceField: string
  /** Parameter name in target operation. */
  targetParam: string
  /** Where the target param goes. */
  targetParamIn: ParamIn
  /** Binding confidence. */
  confidence: number
}

/** A single signal that contributed to an edge score. */
export interface EdgeSignal {
  /** Signal name. Built-in values autocomplete; custom signal IDs accepted. */
  signal: BuiltInSignal | (string & {})
  /** Weight contribution (0.0-1.0). */
  weight: number
  /** Whether this signal matched. */
  matched: boolean
  /** Details string for debugging. */
  detail?: string
}

/** A directed graph of operations and their relationships. */
export interface OperationGraph {
  /** All operations as graph nodes. */
  nodes: InferenceOperation[]
  /** Directed edges representing data flow between operations. */
  edges: OperationEdge[]
  /** Signals that threw during execution. Empty/absent if all signals succeeded. */
  signalErrors?: SignalError[]
}

/** A signal that failed during graph construction. */
export interface SignalError {
  /** Signal ID that failed. */
  id: string
  /** Human-readable error message. */
  message: string
  /** The original error that was thrown. */
  error: unknown
}

// === Workflows ===

/** Known workflow patterns. */
export const WorkflowPattern = {
  /** List → Detail: GET /resources → GET /resources/{id} */
  Browse: 'browse',
  /** Full CRUD: create/read/update/delete on same resource */
  CRUD: 'crud',
  /** Search with filters → Detail endpoint */
  SearchDetail: 'search-detail',
  /** POST creates resource → GET retrieves it with returned ID */
  CreateThenGet: 'create-then-get',
  /** Plugin-defined custom workflow */
  Custom: 'custom',
} as const
export type WorkflowPattern = typeof WorkflowPattern[keyof typeof WorkflowPattern]

/** A named workflow composed from the operation graph. */
export interface Workflow {
  /** Workflow identifier. */
  id: string
  /** Human-readable name (e.g. 'Browse Products', 'User CRUD'). */
  name: string
  /** Description of what this workflow accomplishes. */
  description: string
  /** Pattern type. */
  pattern: WorkflowPattern
  /** Ordered steps in the workflow. */
  steps: WorkflowStep[]
  /** Overall confidence that this is a real workflow (0.0-1.0). */
  confidence: number
}

/** A single step in a workflow. */
export interface WorkflowStep {
  /** Operation ID. */
  operationId: string
  /** Human-readable role in the workflow. */
  role: 'list' | 'detail' | 'create' | 'read' | 'update' | 'delete' | 'search' | 'source' | 'target' | 'prerequisite' | 'goal'
  /** Data bindings from previous step's output to this step's input. */
  inputBindings: DataBinding[]
}

// === Signal function type ===

/** A signal function produces candidate edges from a set of operations. */
export type SignalFunction = (operations: InferenceOperation[]) => OperationEdge[]

/** A registered signal with metadata. */
export interface SignalRegistration {
  /** Unique signal ID, e.g. 'id-pattern', 'my-custom-signal'. */
  readonly id: string
  /** The signal function. */
  readonly signal: SignalFunction
  /** Optional weight for documentation/introspection (0.0-1.0). Does not affect scoring —
      scoring is determined by the edge scores the signal returns. */
  readonly weight?: number
}

// === Runtime Value Matching ===

/** A value extracted from a live API response for cross-probe matching. */
export type RuntimeProbeValue =
  | { fieldPath: string; value: string; type: 'string' }
  | { fieldPath: string; value: number; type: 'number' }

/** Result of probing a single endpoint. */
export interface RuntimeProbeResult {
  /** Operation that was probed. */
  operationId: string
  /** Values extracted from the response. */
  values: RuntimeProbeValue[]
  /** Whether the probe succeeded (false = network/auth error, skip). */
  success: boolean
  /** Error message when success is false. */
  error?: string
}
