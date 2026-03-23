/**
 * Types for LLM chat integration.
 *
 * Core message/tool types are re-exported from @api2aux/chat-engine.
 * UI-specific types (UIMessage, ProviderId, ChatConfig) remain here.
 */

// Re-export core types from the engine package
export type {
  ChatMessage,
  ToolCall,
  Tool,
  ToolParameter,
  StreamResult,
  ToolResultEntry,
  StructuredResponse,
} from '@api2aux/chat-engine'

import type { ToolResultEntry, StructuredResponse, ChatMessage } from '@api2aux/chat-engine'

/** A message in the chat UI. Analogous to ChatMessage but with a UI-oriented shape (text instead of content, tool-result role, loading/error states). */
export interface UIMessage {
  id: string
  role: 'user' | 'assistant' | 'tool-result'
  text: string | null
  /** API response data to render with DynamicRenderer */
  apiData?: unknown
  /** Which tool was called */
  toolName?: string
  /** Tool call arguments */
  toolArgs?: Record<string, unknown>
  /** All tool results from this turn (for "view result" links) */
  toolResults?: ToolResultEntry[]
  /** Structured response from the chat engine — merged when multiple sources, focused when single source. */
  structured?: StructuredResponse
  /** Is this message still streaming/loading */
  loading?: boolean
  /** Error message if something went wrong */
  error?: string
  timestamp: number
}

// ── Call log (debug) ──

export interface ApiCallEntry {
  type: 'api'
  toolName: string
  args: Record<string, unknown>
  /** 'success' and 'cached' have `response`; 'error' has `error`. */
  status: 'success' | 'error' | 'cached'
  response?: unknown
  error?: string
  durationMs: number
  timestamp: number
}

export interface LlmCallEntry {
  type: 'llm'
  purpose: 'stream' | 'focus'
  model: string
  messages: ChatMessage[]
  response?: string
  toolCalls?: Array<{ name: string; args: string }>
  error?: string
  durationMs: number
  timestamp: number
}

export type CallLogEntry = ApiCallEntry | LlmCallEntry

export type ProviderId = 'openrouter' | 'anthropic' | 'openai' | 'groq' | 'deepseek' | 'xai' | 'moonshot'

export interface ChatConfig {
  apiKey: string
  model: string
  provider: ProviderId
}
