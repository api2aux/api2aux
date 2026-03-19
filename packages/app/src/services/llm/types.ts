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
} from '@api2aux/chat-engine'

import type { ToolResultEntry } from '@api2aux/chat-engine'

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
  /** Is this message still streaming/loading */
  loading?: boolean
  /** Error message if something went wrong */
  error?: string
  timestamp: number
}

export type ProviderId = 'openrouter' | 'anthropic' | 'openai' | 'groq' | 'deepseek' | 'xai' | 'moonshot'

export interface ChatConfig {
  apiKey: string
  model: string
  provider: ProviderId
}
