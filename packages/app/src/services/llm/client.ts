/**
 * LLM API client for chat. Calls OpenAI-compatible endpoints from the browser.
 * OpenRouter supports CORS natively; other providers (OpenAI) are routed
 * through the Vite CORS proxy.
 */

import type { ChatMessage, Tool, LLMResponse, ChatConfig, StreamChunk, StreamResult, ToolCall } from './types'

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const OPENAI_BASE = 'https://api.openai.com/v1'

function getBaseUrl(provider: ChatConfig['provider']): string {
  switch (provider) {
    case 'openrouter': return OPENROUTER_BASE
    case 'openai': return OPENAI_BASE
    case 'anthropic': return OPENROUTER_BASE // Anthropic models via OpenRouter
  }
}

function proxyUrl(url: string): string {
  return `/api-proxy/${encodeURIComponent(url)}`
}

function needsProxy(provider: ChatConfig['provider']): boolean {
  // OpenRouter supports CORS natively; all other providers need the proxy
  return provider !== 'openrouter'
}

/**
 * Send a chat completion request with tool definitions.
 * Returns the assistant's response (may include tool_calls).
 */
export async function chatCompletion(
  messages: ChatMessage[],
  tools: Tool[],
  config: ChatConfig,
): Promise<LLMResponse> {
  const baseUrl = getBaseUrl(config.provider)
  const endpoint = `${baseUrl}/chat/completions`
  const url = needsProxy(config.provider) ? proxyUrl(endpoint) : endpoint

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
  }

  if (tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      ...(config.provider === 'openrouter' ? {
        'HTTP-Referer': window.location.origin,
        'X-Title': 'api2aux',
      } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    let detail = response.statusText
    try {
      const errBody = await response.json()
      detail = errBody?.error?.message ?? JSON.stringify(errBody)
    } catch { /* use statusText */ }
    throw new Error(`LLM API error (${response.status}): ${detail}`)
  }

  return response.json() as Promise<LLMResponse>
}

/**
 * Streaming chat completion. Calls the same endpoint with stream: true.
 * Yields text chunks as they arrive. Accumulates tool_calls internally
 * and returns them in the final StreamResult.
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
  const baseUrl = getBaseUrl(config.provider)
  const endpoint = `${baseUrl}/chat/completions`
  const url = needsProxy(config.provider) ? proxyUrl(endpoint) : endpoint

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
  }

  if (tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      ...(config.provider === 'openrouter' ? {
        'HTTP-Referer': window.location.origin,
        'X-Title': 'api2aux',
      } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })

  if (!response.ok) {
    let detail = response.statusText
    try {
      const errBody = await response.json()
      detail = errBody?.error?.message ?? JSON.stringify(errBody)
    } catch { /* use statusText */ }
    throw new Error(`LLM API error (${response.status}): ${detail}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body for streaming')

  const decoder = new TextDecoder()
  let content = ''
  let finishReason = 'stop'
  // Accumulate tool_calls by index
  const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Process complete SSE lines
    const lines = buffer.split('\n')
    // Keep the last potentially incomplete line in buffer
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'data: [DONE]') continue
      if (!trimmed.startsWith('data: ')) continue

      let chunk: StreamChunk
      try {
        chunk = JSON.parse(trimmed.slice(6))
      } catch {
        continue
      }

      const choice = chunk.choices[0]
      if (!choice) continue

      if (choice.finish_reason) {
        finishReason = choice.finish_reason
      }

      const delta = choice.delta

      // Text content
      if (delta.content) {
        content += delta.content
        onToken(delta.content)
      }

      // Tool calls (accumulated by index)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallMap.get(tc.index)
          if (existing) {
            // Append to existing tool call's arguments
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
  }

  // Build final tool_calls array
  const tool_calls: ToolCall[] = []
  for (const [, tc] of [...toolCallMap.entries()].sort((a, b) => a[0] - b[0])) {
    tool_calls.push({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
    })
  }

  return { content, tool_calls, finish_reason: finishReason }
}

/** Default models for each provider */
export const DEFAULT_MODELS: Record<ChatConfig['provider'], string> = {
  openrouter: 'anthropic/claude-haiku',
  openai: 'gpt-4o-mini',
  anthropic: 'anthropic/claude-haiku',
}
