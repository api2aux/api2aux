/**
 * @api2aux/chat-engine
 *
 * Pluggable chat engine for API-driven conversations.
 * Extracts data from APIs via LLM tool calling and returns structured + text responses.
 * Zero React dependency — works in Node.js, browser, or any TS environment.
 */

// === Types ===
export type {
  ChatMessage,
  ToolCall,
  Tool,
  ToolParameter,
  StreamResult,
  ToolResultEntry,
  LLMCompletionFn,
  ToolExecutorFn,
  ApiSpec,
  ApiOperation,
  ChatEngineContext,
  ChatEngineConfig,
  ChatEngineEvent,
  ChatEngineEventHandler,
  ChatEngineResponse,
  ChatEnginePlugin,
  StructuredResponse,
} from './types'

export { MergeStrategy, ChatEventType } from './types'

// === Defaults ===
export { MAX_ROUNDS, TRUNCATION_LIMIT, NO_DATA_MESSAGE } from './defaults'
