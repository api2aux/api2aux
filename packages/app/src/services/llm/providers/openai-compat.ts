/**
 * Factory for OpenAI-compatible LLM providers.
 * Uses the openai SDK which handles SSE parsing, streaming, retries, etc.
 * Each provider is just a config object — the SDK does the heavy lifting.
 */

import OpenAI from 'openai'
import type { LLMProvider, ProviderModel } from './types'
import type { ChatMessage, Tool, ToolCall, StreamResult, ProviderId } from '../types'

interface OpenAICompatConfig {
  id: ProviderId
  name: string
  baseURL: string
  browserCors: boolean
  models: ProviderModel[]
  keyPlaceholder: string
  keyHelpUrl?: string
  /** Extra headers to send with every request (e.g. OpenRouter's Referer) */
  defaultHeaders?: Record<string, string>
}

export function createOpenAICompatProvider(providerConfig: OpenAICompatConfig): LLMProvider {
  return {
    id: providerConfig.id,
    name: providerConfig.name,
    browserCors: providerConfig.browserCors,
    models: providerConfig.models,
    keyPlaceholder: providerConfig.keyPlaceholder,
    keyHelpUrl: providerConfig.keyHelpUrl,

    async streamCompletion(
      messages: ChatMessage[],
      tools: Tool[],
      config: { apiKey: string; model: string },
      onToken: (token: string) => void,
    ): Promise<StreamResult> {
      // For non-CORS providers, route through the Vite dev proxy
      const effectiveBaseURL = providerConfig.browserCors
        ? providerConfig.baseURL
        : `/api-proxy/${encodeURIComponent(providerConfig.baseURL)}`

      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: effectiveBaseURL,
        dangerouslyAllowBrowser: true,
        defaultHeaders: providerConfig.defaultHeaders,
      })

      const stream = await client.chat.completions.create({
        model: config.model,
        messages: messages as OpenAI.ChatCompletionMessageParam[],
        ...(tools.length > 0 ? {
          tools: tools as OpenAI.ChatCompletionTool[],
          tool_choice: 'auto' as const,
        } : {}),
        stream: true,
      })

      let content = ''
      let finishReason: StreamResult['finish_reason'] = 'stop'
      const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>()

      for await (const chunk of stream) {
        const choice = chunk.choices[0]
        if (!choice) continue

        if (choice.finish_reason) {
          finishReason = choice.finish_reason as StreamResult['finish_reason']
        }

        // Text content — stream to UI
        if (choice.delta.content) {
          content += choice.delta.content
          onToken(choice.delta.content)
        }

        // Tool calls — accumulate by index
        if (choice.delta.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const existing = toolCallMap.get(tc.index)
            if (existing) {
              if (tc.function?.arguments) {
                existing.arguments += tc.function.arguments
              }
            } else {
              toolCallMap.set(tc.index, {
                id: tc.id ?? '',
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? '',
              })
            }
          }
        }
      }

      // Build final tool_calls array sorted by index
      const tool_calls: ToolCall[] = [...toolCallMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, tc]) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }))

      return { content, tool_calls, finish_reason: finishReason }
    },
  }
}
