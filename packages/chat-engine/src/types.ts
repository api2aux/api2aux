/**
 * @api2aux/chat-engine
 *
 * Core types for the chat engine package.
 * Defines messages, tools, engine context, events, responses, and plugin interfaces.
 */

// ── LLM Message Types (OpenAI-compatible format) ──

/** Chat message roles. */
export const MessageRole = {
  System: 'system',
  User: 'user',
  Assistant: 'assistant',
  Tool: 'tool',
} as const
export type MessageRole = typeof MessageRole[keyof typeof MessageRole]

/** Tool call/definition type (OpenAI function-calling format). */
export const ToolType = {
  Function: 'function',
} as const
export type ToolType = typeof ToolType[keyof typeof ToolType]

export type ChatMessage =
  | { role: typeof MessageRole.System; content: string }
  | { role: typeof MessageRole.User; content: string }
  | { role: typeof MessageRole.Assistant; content: string; tool_calls?: undefined; tool_call_id?: undefined }
  | { role: typeof MessageRole.Assistant; content: null; tool_calls: ToolCall[]; tool_call_id?: undefined }
  | { role: typeof MessageRole.Tool; content: string; tool_call_id: string; tool_calls?: undefined }

export interface ToolCall {
  id: string
  type: typeof ToolType.Function
  function: {
    name: string
    arguments: string
  }
}

export interface Tool {
  type: typeof ToolType.Function
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, ToolParameter>
      required?: string[]
      additionalProperties?: boolean
    }
  }
}

export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  default?: unknown
}

/** LLM completion finish reasons. */
export const FinishReason = {
  Stop: 'stop',
  ToolCalls: 'tool_calls',
  Length: 'length',
  ContentFilter: 'content_filter',
} as const
export type FinishReason = typeof FinishReason[keyof typeof FinishReason]

/**
 * The result of a streaming completion.
 * When tool_calls is non-empty, content is typically empty (the LLM chose to call tools
 * instead of responding with text). The engine branches on tool_calls.length.
 */
export interface StreamResult {
  content: string
  tool_calls: ToolCall[]
  finish_reason: FinishReason
}

/** A collected tool result from a single API call within a turn. */
export interface ToolResultEntry {
  toolName: string
  toolArgs: Record<string, unknown>
  data: unknown
  summary: string
}

// ── Injected Dependencies ──

/** The engine's view of an LLM — a single streaming function. */
export type LLMCompletionFn = (
  messages: ChatMessage[],
  tools: Tool[],
  onToken: (token: string) => void,
) => Promise<StreamResult>

/** Non-streaming LLM text completion for merge/focus calls. Runs independently of the streaming context. */
export type LLMTextFn = (
  messages: ChatMessage[],
) => Promise<string>

/** Executes a tool call and returns raw API response data. */
export type ToolExecutorFn = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>

// ── API Context (structural typing, no ParsedAPI import) ──

/** The engine's structural view of a parsed API spec. */
export interface ApiSpec {
  title: string
  baseUrl: string
  operations: ApiOperation[]
  authSchemes?: Array<{ authType?: string | null }>
}

/** Valid parameter locations (compatible with @api2aux/tool-utils ParameterIn). */
export const ApiParamIn = {
  Query: 'query',
  Path: 'path',
  Header: 'header',
  Cookie: 'cookie',
  Body: 'body',
} as const
export type ApiParamIn = typeof ApiParamIn[keyof typeof ApiParamIn]

/** HTTP methods (uppercase to match api-invoke parser output and cross-package conventions). */
export const HttpMethod = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Delete: 'DELETE',
  Patch: 'PATCH',
  Options: 'OPTIONS',
  Head: 'HEAD',
} as const
export type HttpMethod = typeof HttpMethod[keyof typeof HttpMethod]

/** Minimal operation shape needed by the engine. */
export interface ApiOperation {
  id: string
  path: string
  method: string
  summary?: string
  description?: string
  tags: string[]
  parameters: Array<{
    name: string
    in: ApiParamIn
    required: boolean
    description: string
    schema: {
      type: string
      format?: string
      default?: unknown
      example?: unknown
      enum?: unknown[]
      minimum?: number
      maximum?: number
      maxLength?: number
    }
  }>
  responseSchema?: unknown
  requestBody?: { description?: string; required: boolean }
}

// ── Merge Strategy ──

export const MergeStrategy = {
  /** Return each tool result separately with source metadata. */
  Array: 'array',
  /** Use an extra LLM call to merge or focus results into a single document. */
  LlmGuided: 'llm-guided',
  /** Merge results deterministically by detecting shared entity IDs. */
  SchemaBased: 'schema-based',
} as const
export type MergeStrategy = typeof MergeStrategy[keyof typeof MergeStrategy]

// ── Focus Reduction Strategy ──

export const FocusReduction = {
  /** Keep all fields, truncate long values. No extra calls. */
  TruncateValues: 'truncate-values',
} as const
export type FocusReduction = typeof FocusReduction[keyof typeof FocusReduction]

// ── Engine Context & Config ──

/** Full context the engine needs to operate. Replace wholesale via setContext(). */
export interface ChatEngineContext {
  /** Raw API URL (used for raw-URL mode and fallbacks). */
  readonly url: string
  /** Parsed OpenAPI spec, if available. Null for raw URL mode. */
  readonly spec: ApiSpec | null
  /** Pre-built tools (from buildToolsFromSpec/Url). */
  readonly tools: readonly Tool[]
  /** Base system prompt (from buildSystemPrompt). May be modified by plugins before each LLM call. */
  readonly systemPrompt: string
}

/** Engine configuration. */
export interface ChatEngineConfig {
  /** Maximum tool-calling rounds before forcing a text response. Default: 3. */
  maxRounds?: number
  /** Maximum characters of tool result to feed back to LLM. Default: 8000. */
  truncationLimit?: number
  /** Strategy for merging/focusing tool results. Default: MergeStrategy.LlmGuided. */
  mergeStrategy?: MergeStrategy
  /** Non-streaming LLM for merge/focus calls. When provided, runs in a separate async context from the streaming LLM. Falls back to the streaming LLM with a no-op token handler if not set. */
  llmText?: LLMTextFn
  /** Strategy for reducing data before the focus/merge LLM call. Default: 'truncate-values'. */
  focusReduction?: FocusReduction
}

// ── Events ──

export const ChatEventType = {
  /** A streamed text token from the LLM. */
  Token: 'token',
  /** A tool call is about to start. */
  ToolCallStart: 'tool_call_start',
  /** A tool call completed successfully. */
  ToolCallResult: 'tool_call_result',
  /** A tool call failed. */
  ToolCallError: 'tool_call_error',
  /** Tool results are being focused/merged before generating the text response. */
  DataProcessing: 'data_processing',
  /** Structured data is ready. Fires before the text response begins. TurnComplete carries the same resolved object; consumers should avoid processing it twice. */
  StructuredReady: 'structured_ready',
  /** The full turn is complete. */
  TurnComplete: 'turn_complete',
  /** An unrecoverable error occurred. */
  Error: 'error',
} as const
export type ChatEventType = typeof ChatEventType[keyof typeof ChatEventType]

export type ChatEngineEvent =
  | { type: typeof ChatEventType.Token; token: string }
  | { type: typeof ChatEventType.ToolCallStart; toolCallId: string; toolName: string; toolArgs: Record<string, unknown>; parallelCount: number }
  | { type: typeof ChatEventType.ToolCallResult; toolCallId: string; toolName: string; toolArgs: Record<string, unknown>; data: unknown; summary: string }
  | { type: typeof ChatEventType.ToolCallError; toolCallId: string; toolName: string; toolArgs: Record<string, unknown>; error: string }
  | { type: typeof ChatEventType.DataProcessing }
  | { type: typeof ChatEventType.StructuredReady; structured: StructuredResponse }
  | { type: typeof ChatEventType.TurnComplete; text: string; toolResults: ToolResultEntry[]; structured: StructuredResponse }
  | { type: typeof ChatEventType.Error; error: string }

export type ChatEngineEventHandler = (event: ChatEngineEvent) => void

// ── Structured Response ──

interface StructuredResponseBase {
  /** Source API calls that produced the data. */
  sources: Array<{ toolName: string; toolArgs: Record<string, unknown> }>
}

/** Discriminated union — narrow on `strategy` to get a typed `data` shape. */
export type StructuredResponse =
  | StructuredResponseBase & { strategy: typeof MergeStrategy.Array; data: unknown[] }
  | StructuredResponseBase & { strategy: typeof MergeStrategy.SchemaBased; data: Record<string, unknown>[] }
  | StructuredResponseBase & { strategy: typeof MergeStrategy.LlmGuided; data: unknown }

// ── Engine Response ──

/** The final result of a sendMessage call. */
export interface ChatEngineResponse {
  /** The assistant's text response. */
  text: string
  /** Structured tool results from this turn (JSON data from APIs). */
  toolResults: ToolResultEntry[]
  /** Structured response with merged data for UI rendering. */
  structured: StructuredResponse
  /** Updated conversation history. */
  history: ChatMessage[]
}

// ── Plugin Interface ──

/** Plugin that can customize engine behavior for a domain. */
export interface ChatEnginePlugin {
  /** Unique plugin ID. */
  readonly id: string

  /**
   * Modify the system prompt before it is sent to the LLM.
   * Return the modified prompt, or null to use the base unchanged.
   */
  modifySystemPrompt?: (basePrompt: string, context: ChatEngineContext) => string | null

  /**
   * Filter or reorder tools before they are sent to the LLM.
   * Can remove tools irrelevant to the domain, or add synthetic tools.
   */
  modifyTools?: (tools: Tool[], context: ChatEngineContext) => Tool[]

  /**
   * Post-process a tool result before it is fed back to the LLM.
   * Can extract/reshape data for domain-specific summarization.
   */
  processToolResult?: (toolName: string, data: unknown) => unknown

  /**
   * Post-process the final text response.
   * Can enforce domain-specific response formatting or safety checks.
   */
  processResponse?: (text: string, toolResults: ToolResultEntry[]) => string
}
