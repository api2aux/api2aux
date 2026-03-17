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
  /** HTTP method (e.g. 'GET', 'POST'). */
  method: string
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

/** A parameter of an inference operation. */
export interface InferenceParam {
  /** Parameter name. */
  name: string
  /** Where the parameter appears: 'path', 'query', 'header', 'cookie', 'body'. */
  in: string
  /** Data type (e.g. 'string', 'integer'). */
  type: string
  /** Format hint (e.g. 'uuid', 'date-time'). */
  format?: string
  /** Whether the parameter is required. */
  required: boolean
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
  targetParamIn: string
  /** Binding confidence. */
  confidence: number
}

/** A single signal that contributed to an edge score. */
export interface EdgeSignal {
  /** Signal name: 'id-pattern', 'schema-compat', 'rest-convention', 'tag-proximity', 'name-similarity', 'plugin-boost'. */
  signal: string
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
  /** Human-readable role: 'list', 'search', 'detail', 'create', 'update', 'delete'. */
  role: string
  /** Data bindings from previous step's output to this step's input. */
  inputBindings: DataBinding[]
}

// === Signal function type ===

/** A signal function produces candidate edges from a set of operations. */
export type SignalFunction = (operations: InferenceOperation[]) => OperationEdge[]
