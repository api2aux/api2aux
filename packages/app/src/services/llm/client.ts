/**
 * LLM API client for chat.
 * Delegates to provider-specific adapters via the registry.
 * Each provider handles its own format, streaming, and CORS needs.
 */

import type { ChatMessage, Tool, ChatConfig, StreamResult } from './types'
import { getProvider } from './providers/registry'

/**
 * Send a streaming chat completion request.
 * Routes to the correct provider adapter based on config.provider.
 *
 * @param onToken - called with each text token as it arrives
 * @returns the final accumulated result (full content + any tool_calls)
 */
export async function chatCompletionStream(
  messages: ChatMessage[],
  tools: Tool[],
  config: ChatConfig,
  onToken: (token: string) => void,
): Promise<StreamResult> {
  const provider = getProvider(config.provider)
  if (!provider) {
    throw new Error(`Unknown LLM provider: ${config.provider}`)
  }

  return provider.streamCompletion(messages, tools, config, onToken)
}

/**
 * Send a non-streaming chat completion request.
 * Used for merge/focus calls that don't need token-by-token output.
 * Runs in a separate async context from streaming, enabling true parallel execution.
 */
export async function chatCompletion(
  messages: ChatMessage[],
  config: ChatConfig,
): Promise<string> {
  const provider = getProvider(config.provider)
  if (!provider) {
    throw new Error(`Unknown LLM provider: ${config.provider}`)
  }

  return provider.complete(messages, config)
}
