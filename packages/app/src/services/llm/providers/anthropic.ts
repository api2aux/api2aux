/**
 * Anthropic provider adapter.
 * Uses the @anthropic-ai/sdk which handles the Messages API format,
 * SSE streaming, and the `anthropic-dangerous-direct-browser-access` header.
 *
 * Key differences from OpenAI format:
 * - System prompt is a separate field, not a message role
 * - Tool calls are `tool_use` content blocks inside the assistant message
 * - Tool results are `tool_result` messages with content blocks
 * - SSE events use named types (message_start, content_block_delta, etc.)
 */

import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider } from './types'
import type { ChatMessage, Tool, ToolCall, StreamResult } from '../types'

/** Convert our OpenAI-style ChatMessage[] to Anthropic's format */
function toAnthropicMessages(messages: ChatMessage[]): {
  system: string
  messages: Anthropic.MessageParam[]
} {
  let system = ''
  const anthropicMsgs: Anthropic.MessageParam[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      system += (system ? '\n\n' : '') + (msg.content ?? '')
      continue
    }

    if (msg.role === 'user') {
      anthropicMsgs.push({ role: 'user', content: msg.content ?? '' })
      continue
    }

    if (msg.role === 'assistant') {
      // Assistant message may have text content and/or tool_calls
      const content: Anthropic.ContentBlockParam[] = []

      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }

      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: unknown = {}
          try { input = JSON.parse(tc.function.arguments) } catch { /* empty */ }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: input as Record<string, unknown>,
          })
        }
      }

      if (content.length > 0) {
        anthropicMsgs.push({ role: 'assistant', content })
      }
      continue
    }

    if (msg.role === 'tool') {
      // Tool result — Anthropic expects this as a user message with tool_result content
      anthropicMsgs.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id ?? '',
          content: msg.content ?? '',
        }],
      })
    }
  }

  return { system, messages: anthropicMsgs }
}

/** Convert our OpenAI-style Tool[] to Anthropic's format */
function toAnthropicTools(tools: Tool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }))
}

export const anthropicProvider: LLMProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  browserCors: true,
  keyPlaceholder: 'sk-ant-...',
  keyHelpUrl: 'https://console.anthropic.com/settings/keys',
  models: [
    { value: 'claude-haiku-4-5', label: 'Claude 4.5 Haiku (fast)' },
    { value: 'claude-sonnet-4-6', label: 'Claude 4.6 Sonnet' },
    { value: 'claude-opus-4-6', label: 'Claude 4.6 Opus (flagship)' },
  ],

  async streamCompletion(
    messages: ChatMessage[],
    tools: Tool[],
    config: { apiKey: string; model: string },
    onToken: (token: string) => void,
  ): Promise<StreamResult> {
    const client = new Anthropic({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
    })

    const { system, messages: anthropicMsgs } = toAnthropicMessages(messages)
    const anthropicTools = tools.length > 0 ? toAnthropicTools(tools) : undefined

    const stream = client.messages.stream({
      model: config.model,
      system,
      messages: anthropicMsgs,
      ...(anthropicTools ? { tools: anthropicTools } : {}),
      max_tokens: 4096,
    })

    // Accumulate text and tool_use blocks
    let content = ''
    const toolCalls: ToolCall[] = []

    // The SDK emits typed events — `text` fires for each text delta
    stream.on('text', (textDelta) => {
      content += textDelta
      onToken(textDelta)
    })

    // Wait for the full message to extract tool_use blocks
    const finalMessage = await stream.finalMessage()

    // Extract tool_use blocks from the final message content
    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        })
      }
    }

    return {
      content,
      tool_calls: toolCalls,
      finish_reason: finalMessage.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    }
  },

  async complete(
    messages: ChatMessage[],
    config: { apiKey: string; model: string },
  ): Promise<string> {
    const client = new Anthropic({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
    })

    const { system, messages: anthropicMsgs } = toAnthropicMessages(messages)

    const response = await client.messages.create({
      model: config.model,
      system,
      messages: anthropicMsgs,
      max_tokens: 4096,
      stream: false,
    }, {
      maxRetries: 2,
      timeout: 30_000,
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text' || !textBlock.text) {
      throw new Error(`[anthropic] complete() received no text content (stop_reason: ${response.stop_reason})`)
    }
    return textBlock.text
  },
}
