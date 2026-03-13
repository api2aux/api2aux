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
import { chatCompletionStream } from '../services/llm/client'
import { buildToolsFromUrl, buildToolsFromSpec, buildSystemPrompt } from '../services/llm/toolBuilder'
import { generateToolName } from '@api2aux/tool-utils'
import { useParameterStore } from '../store/parameterStore'
import { fetchWithAuth, credentialToAuth } from '../services/api/fetcher'
import { executeOperation, corsProxy } from 'api-invoke'
import { useAuthStore } from '../store/authStore'
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

  // Spec mode: use executeOperation which handles buildBody hooks (GraphQL),
  // CORS proxy, auth injection, and proper body serialization
  const parsedSpec = useAppStore.getState().parsedSpec
  if (parsedSpec) {
    const operation = parsedSpec.operations.find(op =>
      generateToolName(op) === toolName
    )

    if (operation) {
      // Build args: if operation has buildBody (GraphQL), body fields go as top-level args;
      // otherwise parse args.body string back into the body key
      const execArgs: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(args)) {
        if (k === 'body') continue
        execArgs[k] = v
      }
      if (args.body) {
        const parsed = typeof args.body === 'string' ? JSON.parse(args.body as string) : args.body
        if (operation.buildBody && typeof parsed === 'object' && parsed !== null) {
          Object.assign(execArgs, parsed)
        } else {
          execArgs.body = parsed
        }
      }

      const credential = useAuthStore.getState().getActiveCredential(parsedSpec.baseUrl)
      const result = await executeOperation(parsedSpec.baseUrl, operation, execArgs, {
        auth: credential ? credentialToAuth(credential) : undefined,
        middleware: [corsProxy()],
      })
      return result.data
    }
  }

  // Fallback: just call the base URL
  return fetchWithAuth(apiUrl)
}

/** Sync the UI operation selector + parameter chips to reflect a chat tool call.
 *  Sets selectedOperationIndex without clearing data (unlike setSelectedOperation). */
function syncOperationUI(toolName: string, toolArgs: Record<string, unknown>) {
  const state = useAppStore.getState()
  const { parsedSpec } = state
  if (!parsedSpec) return

  const opIndex = parsedSpec.operations.findIndex(op => generateToolName(op) === toolName)
  if (opIndex < 0) return

  // Set index directly — don't use setSelectedOperation which clears data/schema
  useAppStore.setState({ selectedOperationIndex: opIndex })

  // Set parameter values so filter chips and URL preview appear
  const operation = parsedSpec.operations[opIndex]!
  const endpoint = `${parsedSpec.baseUrl}${operation.path}`
  const paramValues: Record<string, string> = {}
  for (const [key, value] of Object.entries(toolArgs)) {
    if (value !== undefined && value !== '') {
      paramValues[key] = String(value)
    }
  }
  if (Object.keys(paramValues).length > 0) {
    useParameterStore.getState().setValues(endpoint, paramValues)
  }
}

/** Auto-select the tab whose name best matches the LLM response text */
function autoSelectTab(data: unknown, responseText: string) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return

  // Extract nested (non-primitive) field names — these become tab names
  const fields = Object.entries(data as Record<string, unknown>)
    .filter(([, v]) => v !== null && typeof v === 'object')
    .map(([k]) => k)

  if (fields.length < 2) return // no tabs or only one tab — nothing to select

  // Tokenize: split camelCase/snake_case into lowercase words
  const tokenize = (s: string) =>
    s.toLowerCase()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[\s_\-/]+/)
      .filter(w => w.length > 2)

  const responseWords = new Set(tokenize(responseText))

  let bestIndex = 0
  let bestScore = 0

  for (let i = 0; i < fields.length; i++) {
    const tabWords = tokenize(fields[i]!)
    const score = tabWords.reduce((sum, w) => sum + (responseWords.has(w) ? 1 : 0), 0)
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  if (bestScore > 0) {
    useAppStore.getState().setTabSelection('$', bestIndex)
  }
}

// LLM-format history that preserves tool_calls and tool responses.
let llmHistory: ChatMessage[] = []

export function useChat() {
  const url = useAppStore((s) => s.url)
  const parsedSpec = useAppStore((s) => s.parsedSpec)
  const { messages, addMessage, updateMessage, clearMessages: storeClearMessages, config, sending, setSending, setChatApiUrl } = useChatStore()

  // Wrap clearMessages to also reset LLM history
  const clearMessages = useCallback(() => {
    storeClearMessages()
    llmHistory = []
  }, [storeClearMessages])

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

    // Track which API this chat belongs to
    if (messages.length === 0) {
      setChatApiUrl(url?.split('?')[0] ?? '')
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

      // Tool calling loop with streaming: allow up to MAX_ROUNDS of LLM→tool→LLM cycles.
      // Each round streams text tokens to the UI. If tool_calls come back instead,
      // execute them and loop again.
      const MAX_ROUNDS = 3
      let roundCount = 0
      const collectedResults: ToolResultEntry[] = []

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const llmMessages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          ...llmHistory,
        ]
        // On last allowed round, send no tools to force a text response
        const roundTools = roundCount >= MAX_ROUNDS ? [] : tools

        // Stream the response — text tokens update the UI live
        let streamedText = ''
        const streamResult = await chatCompletionStream(
          llmMessages,
          roundTools,
          config,
          (token) => {
            streamedText += token
            updateMessage(assistantId, { text: streamedText })
          },
        )

        // If no tool calls, this was the final text response
        if (streamResult.tool_calls.length === 0) {
          const responseText = streamResult.content || 'Done.'
          llmHistory.push({ role: 'assistant', content: responseText })
          updateMessage(assistantId, {
            text: responseText,
            loading: false,
            ...(collectedResults.length > 0 ? { toolResults: collectedResults } : {}),
          })

          // Auto-select the most relevant tab based on the LLM response text
          if (collectedResults.length > 0) {
            const lastData = collectedResults[collectedResults.length - 1]!.data
            autoSelectTab(lastData, responseText)
          }
          break
        }

        // Tool calls returned — execute them, then loop
        roundCount++
        const allToolCalls = streamResult.tool_calls

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

          // Sync operation selection + parameter values so the UI shows what was called
          syncOperationUI(toolCall.function.name, toolArgs)

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

        // Safety: if we've hit max rounds the next iteration will send no tools,
        // forcing a text response
      }
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
