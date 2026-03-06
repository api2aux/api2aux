/**
 * Hook that manages the chat conversation loop:
 * 1. User sends message
 * 2. Call LLM with tool definitions
 * 3. If LLM returns tool_call → execute API call → send result back → get final text
 * 4. Display text + rendered API data
 */

import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { useChatStore } from '../store/chatStore'
import { chatCompletion } from '../services/llm/client'
import { buildToolsFromUrl, buildToolsFromSpec, buildSystemPrompt } from '../services/llm/toolBuilder'
import { fetchWithAuth } from '../services/api/fetcher'
import { inferSchema } from '../services/schema/inferrer'
import type { ChatMessage, UIMessage, Tool, ToolResultEntry } from '../services/llm/types'

let messageCounter = 0
function nextId(): string {
  return `msg-${Date.now()}-${++messageCounter}`
}

/** Generate a compact text summary for a tool result shown in the chat */
function summarizeToolResult(
  data: unknown,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const argStr = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ')

  let countInfo = ''
  if (Array.isArray(data)) {
    countInfo = ` → ${data.length} item${data.length !== 1 ? 's' : ''}`
  } else if (data && typeof data === 'object') {
    countInfo = ` → ${Object.keys(data).length} field${Object.keys(data).length !== 1 ? 's' : ''}`
  }

  return `${toolName}(${argStr})${countInfo} — updated main view`
}

/**
 * Execute a tool call by making the actual API request.
 * For raw URLs: builds URL from base + path + query params.
 * For OpenAPI: delegates to fetchWithAuth with constructed URL.
 */
async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  apiUrl: string,
): Promise<unknown> {
  const parsedUrl = new URL(apiUrl)
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname.replace(/\/$/, '')}`

  if (toolName === 'query_api') {
    // Raw URL mode: build URL from base + path + query params
    let targetUrl = baseUrl
    if (args.path && typeof args.path === 'string') {
      let pathSegment = args.path.startsWith('/') ? args.path : `/${args.path}`
      // Guard against LLM repeating the base pathname (e.g. /products/products)
      const basePath = parsedUrl.pathname.replace(/\/$/, '')
      if (basePath !== '/' && pathSegment.startsWith(basePath)) {
        pathSegment = pathSegment.slice(basePath.length) || ''
      }
      if (pathSegment) targetUrl += pathSegment
    }

    const queryParams = new URLSearchParams()
    for (const [key, value] of Object.entries(args)) {
      if (key !== 'path' && value !== undefined && value !== '') {
        queryParams.set(key, String(value))
      }
    }
    const qs = queryParams.toString()
    if (qs) targetUrl += `?${qs}`

    return fetchWithAuth(targetUrl)
  }

  // OpenAPI mode: build URL from operation spec
  // Find the matching operation from parsedSpec
  const parsedSpec = useAppStore.getState().parsedSpec
  if (parsedSpec) {
    const operation = parsedSpec.operations.find(op => {
      const sanitized = (op.operationId || `${op.method}_${op.path}`)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
      return sanitized === toolName
    })

    if (operation) {
      let path = operation.path
      for (const param of operation.parameters) {
        if (param.in === 'path' && args[param.name] !== undefined) {
          path = path.replace(`{${param.name}}`, encodeURIComponent(String(args[param.name])))
        }
      }

      let opUrl = `${parsedSpec.baseUrl}${path}`
      const queryParams = new URLSearchParams()
      for (const param of operation.parameters) {
        if (param.in === 'query' && args[param.name] !== undefined) {
          queryParams.set(param.name, String(args[param.name]))
        }
      }
      const qs = queryParams.toString()
      if (qs) opUrl += `?${qs}`

      const options = operation.method !== 'get' && args.body
        ? { method: operation.method.toUpperCase(), body: String(args.body) }
        : undefined
      return fetchWithAuth(opUrl, options)
    }
  }

  // Fallback: just call the base URL
  return fetchWithAuth(apiUrl)
}

// LLM-format history that preserves tool_calls and tool responses.
// Reset when clearMessages is called (tracked via messages.length === 0).
let llmHistory: ChatMessage[] = []

export function useChat() {
  const url = useAppStore((s) => s.url)
  const parsedSpec = useAppStore((s) => s.parsedSpec)
  const { messages, addMessage, updateMessage, clearMessages, config, sending, setSending } = useChatStore()

  // Reset LLM history when messages are cleared
  if (messages.length === 0 && llmHistory.length > 0) {
    llmHistory = []
  }

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !url || sending) return
    if (!config.apiKey) {
      addMessage({
        id: nextId(),
        role: 'assistant',
        text: 'Please set your API key in chat settings first.',
        timestamp: Date.now(),
        error: 'No API key configured',
      })
      return
    }

    // Add user message
    const userMsg: UIMessage = {
      id: nextId(),
      role: 'user',
      text: text.trim(),
      timestamp: Date.now(),
    }
    addMessage(userMsg)

    // Add placeholder assistant message
    const assistantId = nextId()
    addMessage({
      id: assistantId,
      role: 'assistant',
      text: null,
      loading: true,
      timestamp: Date.now(),
    })

    setSending(true)

    try {
      // Build tools and system prompt
      const tools: Tool[] = parsedSpec
        ? buildToolsFromSpec(parsedSpec)
        : buildToolsFromUrl(url)

      const systemPrompt = buildSystemPrompt(url, parsedSpec)

      // Add the new user message to LLM history
      llmHistory.push({ role: 'user', content: text.trim() })

      // Build full message array with system prompt
      const llmMessages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...llmHistory,
      ]

      // Tool calling loop: allow up to MAX_ROUNDS of LLM→tool→LLM cycles
      // Each round may have multiple parallel tool_calls that all get executed
      const MAX_ROUNDS = 3
      let roundCount = 0
      const collectedResults: ToolResultEntry[] = []
      let currentResponse = await chatCompletion(llmMessages, tools, config)
      let currentChoice = currentResponse.choices[0]
      if (!currentChoice) throw new Error('No response from LLM')

      while (
        currentChoice.message.tool_calls &&
        currentChoice.message.tool_calls.length > 0 &&
        roundCount < MAX_ROUNDS
      ) {
        roundCount++
        const allToolCalls = currentChoice.message.tool_calls

        // Track assistant message with ALL tool_calls in LLM history
        llmHistory.push({
          role: 'assistant',
          content: null,
          tool_calls: allToolCalls,
        })

        // Execute ALL tool calls and collect responses
        for (const toolCall of allToolCalls) {
          const toolArgs = JSON.parse(toolCall.function.arguments)

          updateMessage(assistantId, {
            text: `Calling ${toolCall.function.name}...${allToolCalls.length > 1 ? ` (${allToolCalls.length} parallel calls)` : ''}`,
            toolName: toolCall.function.name,
            toolArgs,
          })

          let toolResult: unknown
          try {
            toolResult = await executeToolCall(toolCall.function.name, toolArgs, url)
          } catch (err) {
            // Must still add a tool response for this call_id
            llmHistory.push({
              role: 'tool',
              content: `Error: ${err instanceof Error ? err.message : String(err)}`,
              tool_call_id: toolCall.id,
            })
            addMessage({
              id: nextId(),
              role: 'tool-result',
              text: `${toolCall.function.name} failed: ${err instanceof Error ? err.message : String(err)}`,
              toolName: toolCall.function.name,
              toolArgs,
              timestamp: Date.now(),
            })
            continue
          }

          // Push result to main view (last successful call wins)
          const toolSchema = inferSchema(toolResult, url)
          useAppStore.getState().fetchSuccess(toolResult, toolSchema)

          const summary = summarizeToolResult(toolResult, toolCall.function.name, toolArgs)
          collectedResults.push({
            toolName: toolCall.function.name,
            toolArgs,
            data: toolResult,
            summary,
          })

          addMessage({
            id: nextId(),
            role: 'tool-result',
            text: summary,
            toolName: toolCall.function.name,
            toolArgs,
            timestamp: Date.now(),
          })

          const truncatedResult = JSON.stringify(toolResult).slice(0, 8000)
          llmHistory.push({
            role: 'tool',
            content: truncatedResult,
            tool_call_id: toolCall.id,
          })
        }

        // Call LLM again — with tools so it can decide to call more, or respond with text
        const nextMessages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          ...llmHistory,
        ]
        // On last allowed round, send no tools to force a text response
        const nextTools = roundCount >= MAX_ROUNDS ? [] : tools
        currentResponse = await chatCompletion(nextMessages, nextTools, config)
        currentChoice = currentResponse.choices[0]
        if (!currentChoice) throw new Error('No response from LLM')
      }

      // Final text response (either after tool calls or direct response)
      const responseText = currentChoice.message.content || 'Done.'
      llmHistory.push({ role: 'assistant', content: responseText })
      updateMessage(assistantId, {
        text: responseText,
        loading: false,
        // Attach all tool results so the user can click to view any of them
        ...(collectedResults.length > 1 ? { toolResults: collectedResults } : {}),
      })
    } catch (err) {
      updateMessage(assistantId, {
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        loading: false,
        error: String(err),
      })
    } finally {
      setSending(false)
    }
  }, [url, parsedSpec, messages, config, sending, addMessage, updateMessage, setSending])

  // Approximate context size for the UI indicator
  const contextStats = {
    messageCount: llmHistory.length,
    estimatedTokens: Math.ceil(
      llmHistory.reduce((sum, m) => sum + (m.content?.length || 0), 0) / 4
    ),
  }

  return {
    messages,
    sendMessage,
    clearMessages,
    sending,
    hasApiKey: !!config.apiKey,
    contextStats,
    llmHistory,
  }
}
