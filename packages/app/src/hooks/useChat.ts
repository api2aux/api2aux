/**
 * React hook that wraps @api2aux/chat-engine's ChatEngine.
 *
 * This is a thin adapter that:
 * - Injects app-specific dependencies (LLM providers, tool executor, auth)
 * - Maps ChatEngine events to Zustand store actions (UI sync)
 * - Manages UI messages (separate from the engine's LLM history)
 */

import { useCallback, useRef, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { useChatStore } from '../store/chatStore'
import { chatCompletionStream } from '../services/llm/client'
import { buildChatContext, ChatEngine, ChatEventType, hasUsableStructuredData } from '@api2aux/chat-engine'
import type { LLMCompletionFn, ToolExecutorFn, ChatEngineEvent, ChatMessage } from '@api2aux/chat-engine'
import { generateToolName } from '@api2aux/tool-utils'
import { parseUrlParameters } from '../services/urlParser/parser'
import { useParameterStore } from '../store/parameterStore'
import { fetchWithAuth, credentialToAuth } from '../services/api/fetcher'
import { executeOperation } from '@api2aux/api-invoke'
import { proxy } from '../services/api/proxy'
import { useAuthStore } from '../store/authStore'
import type { UIMessage, ApiCallEntry, LlmCallEntry } from '../services/llm/types'
import { updateMainView, scrollToResponseData } from '../utils/chatViewHelpers'

let messageCounter = 0
function nextId(): string {
  return `msg-${Date.now()}-${++messageCounter}`
}

// ── UI-only helpers (stay in the app) ──

/** Sync the UI operation selector + parameter chips to reflect a chat tool call. */
function syncOperationUI(toolName: string, toolArgs: Record<string, unknown>) {
  const state = useAppStore.getState()
  const { parsedSpec } = state
  if (!parsedSpec) return

  const opIndex = parsedSpec.operations.findIndex(op => generateToolName(op) === toolName)
  if (opIndex < 0) return

  useAppStore.setState({ selectedOperationIndex: opIndex })

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

/** Auto-select the tab whose name best matches the LLM response text. */
function autoSelectTab(data: unknown, responseText: string) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return

  const fields = Object.entries(data as Record<string, unknown>)
    .filter(([, v]) => v !== null && typeof v === 'object')
    .map(([k]) => k)

  if (fields.length < 2) return

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

// ── Tool executor (app-specific, injected into engine) ──

/** Filter args to only include params that exist in the URL (prevents LLM hallucinated params). */
function filterToKnownParams(args: Record<string, unknown>, apiUrl: string): Record<string, unknown> {
  try {
    const knownParams = new Set(new URL(apiUrl).searchParams.keys())
    if (knownParams.size === 0) return {}
    const filtered: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(args)) {
      if (knownParams.has(key) && value !== undefined && value !== '') {
        filtered[key] = value
      }
    }
    return filtered
  } catch {
    return args
  }
}

/** Build a cache key from tool name + sorted non-empty args. */
function buildCacheKey(toolName: string, args: Record<string, unknown>): string {
  const sortedArgs = Object.keys(args).sort().reduce((acc, key) => {
    if (args[key] !== undefined && args[key] !== '') acc[key] = args[key]
    return acc
  }, {} as Record<string, unknown>)
  return `${toolName}::${JSON.stringify(sortedArgs)}`
}

function createToolExecutor(apiUrl: string): ToolExecutorFn {
  const execute = async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(apiUrl)
    } catch {
      throw new Error(`Invalid API URL "${apiUrl}". Please check the URL includes a protocol (e.g., https://).`)
    }
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname.replace(/\/$/, '')}`

    if (toolName === 'query_api') {
      const queryParams = new URLSearchParams(parsedUrl.search)
      const knownParams = new Set(queryParams.keys())

      // Only forward args that match known URL params — ignore hallucinated ones
      for (const [key, value] of Object.entries(args)) {
        if (knownParams.has(key) && value !== undefined && value !== '') {
          queryParams.set(key, String(value))
        }
      }
      const qs = queryParams.toString()
      const targetUrl = qs ? `${baseUrl}?${qs}` : baseUrl
      return fetchWithAuth(targetUrl)
    }

    const parsedSpec = useAppStore.getState().parsedSpec
    if (parsedSpec) {
      const operation = parsedSpec.operations.find(op => generateToolName(op) === toolName)

      if (!operation) {
        throw new Error(`Operation "${toolName}" not found in the API spec`)
      }

      const execArgs: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(args)) {
        if (k === 'body') continue
        execArgs[k] = v
      }
      if (args.body) {
        let parsed: unknown
        try {
          parsed = typeof args.body === 'string' ? JSON.parse(args.body as string) : args.body
        } catch (err) {
          throw new Error(`Invalid JSON in request body: ${err instanceof Error ? err.message : String(err)}`)
        }
        if (operation.buildBody && typeof parsed === 'object' && parsed !== null) {
          Object.assign(execArgs, parsed)
        } else {
          execArgs.body = parsed
        }
      }

      const credential = useAuthStore.getState().getActiveCredential(parsedSpec.baseUrl)
      const result = await executeOperation(parsedSpec.baseUrl, operation, execArgs, {
        auth: credential ? credentialToAuth(credential) : undefined,
        middleware: [proxy],
      })
      return result.data
    }

    return fetchWithAuth(apiUrl)
  }

  // Wrap with cache layer + call logging
  return async (toolName: string, rawArgs: Record<string, unknown>): Promise<unknown> => {
    const args = toolName === 'query_api' ? filterToKnownParams(rawArgs, apiUrl) : rawArgs
    const { apiCacheEnabled, apiCache, addCallLogEntry } = useChatStore.getState()
    const cacheKey = buildCacheKey(toolName, args)

    if (apiCacheEnabled) {
      const cached = apiCache.get(cacheKey)
      if (cached !== undefined) {
        addCallLogEntry({ type: 'api', toolName, args, status: 'cached', response: cached, durationMs: 0, timestamp: Date.now() } satisfies ApiCallEntry)
        return cached
      }
    }

    const t0 = Date.now()
    try {
      const result = await execute(toolName, args)
      const durationMs = Date.now() - t0
      addCallLogEntry({ type: 'api', toolName, args, status: 'success', response: result, durationMs, timestamp: Date.now() } satisfies ApiCallEntry)
      if (apiCacheEnabled) {
        useChatStore.getState().apiCache.set(cacheKey, result)
      }
      return result
    } catch (err) {
      addCallLogEntry({ type: 'api', toolName, args, status: 'error', error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0, timestamp: Date.now() } satisfies ApiCallEntry)
      throw err
    }
  }
}

// ── Hook ──

export function useChat() {
  const url = useAppStore((s) => s.url)
  const parsedSpec = useAppStore((s) => s.parsedSpec)
  const { messages, addMessage, updateMessage, clearMessages: storeClearMessages, config, sending, setSending, setChatApiUrl, callLog } = useChatStore()

  const engineRef = useRef<ChatEngine | null>(null)

  // Create LLM functions by closing over config, with call logging
  const llmFn: LLMCompletionFn = useMemo(() => {
    return async (messages, tools, onToken) => {
      const { addCallLogEntry } = useChatStore.getState()
      const t0 = Date.now()
      try {
        const result = await chatCompletionStream(messages, tools, config, onToken)
        const entry: LlmCallEntry = {
          type: 'llm', purpose: 'stream', model: config.model,
          messages, response: result.content,
          toolCalls: result.tool_calls?.map((tc: import('@api2aux/chat-engine').ToolCall) => ({ name: tc.function.name, args: tc.function.arguments })),
          durationMs: Date.now() - t0, timestamp: Date.now(),
        }
        addCallLogEntry(entry)
        return result
      } catch (err) {
        addCallLogEntry({ type: 'llm', purpose: 'stream', model: config.model, messages, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0, timestamp: Date.now() } satisfies LlmCallEntry)
        throw err
      }
    }
  }, [config])

  // Streaming LLM for merge/focus — uses streaming to avoid idle-connection timeouts
  // that plague non-streaming calls with large payloads, while logging as 'focus' purpose
  const llmTextFn = useMemo(() => {
    return async (messages: ChatMessage[]) => {
      const { addCallLogEntry } = useChatStore.getState()
      const t0 = Date.now()
      try {
        const result = await chatCompletionStream(messages, [], config, () => {})
        const response = result.content
        addCallLogEntry({ type: 'llm', purpose: 'focus', model: config.model, messages, response, durationMs: Date.now() - t0, timestamp: Date.now() } satisfies LlmCallEntry)
        return response
      } catch (err) {
        addCallLogEntry({ type: 'llm', purpose: 'focus', model: config.model, messages, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0, timestamp: Date.now() } satisfies LlmCallEntry)
        throw err
      }
    }
  }, [config])

  // Build context from current URL/spec
  const context = useMemo(() => {
    if (!url) return null
    try {
      const urlParams = parseUrlParameters(url).parameters
      return buildChatContext(url, parsedSpec ?? null, urlParams)
    } catch (err) {
      console.error('[useChat] Failed to build chat context:', err instanceof Error ? err.message : String(err))
      return null
    }
  }, [url, parsedSpec])

  // Create or update engine when dependencies change
  const getEngine = useCallback(() => {
    if (!url || !context) return null

    if (!engineRef.current) {
      const executor = createToolExecutor(url)
      engineRef.current = new ChatEngine(llmFn, executor, context, {
        mergeStrategy: 'llm-guided',
        llmText: llmTextFn,
      })
    } else {
      // Clear stale history and cache when switching to a different API
      if (engineRef.current.getContext().url !== context.url) {
        engineRef.current.clearHistory()
        useChatStore.getState().clearApiCache()
      }
      engineRef.current.setContext(context)
      engineRef.current.setLlm(llmFn)
      engineRef.current.setLlmText(llmTextFn)
      engineRef.current.setExecutor(createToolExecutor(url))
    }
    return engineRef.current
  }, [url, context, llmFn, llmTextFn])

  const clearMessages = useCallback(() => {
    storeClearMessages()
    engineRef.current?.clearHistory()
    useChatStore.getState().clearCallLog()
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

    const engine = getEngine()
    if (!engine) {
      addMessage({
        id: nextId(),
        role: 'assistant',
        text: 'Please enter an API URL before sending messages.',
        timestamp: Date.now(),
        error: 'No API URL configured',
      })
      return
    }

    if (useChatStore.getState().messages.length === 0) {
      setChatApiUrl(url?.split('?')[0] ?? '')
    }

    const userMsg: UIMessage = {
      id: nextId(),
      role: 'user',
      text: text.trim(),
      timestamp: Date.now(),
    }
    addMessage(userMsg)

    const assistantId = nextId()
    addMessage({
      id: assistantId,
      role: 'assistant',
      text: null,
      loading: true,
      timestamp: Date.now(),
    })

    setSending(true)
    let streamedText = ''
    let mainPanelUpdated = false

    try {
      const result = await engine.sendMessage(text.trim(), (event: ChatEngineEvent) => {
        switch (event.type) {
          case ChatEventType.Token:
            streamedText += event.token
            updateMessage(assistantId, { text: streamedText, loading: false })
            break

          case ChatEventType.ToolCallStart:
            streamedText = ''
            updateMessage(assistantId, {
              text: event.parallelCount > 1
                ? `Querying ${event.parallelCount} endpoints...`
                : 'Querying API...',
              loading: true,
            })
            syncOperationUI(event.toolName, event.toolArgs)
            break

          case ChatEventType.ToolCallResult:
            updateMessage(assistantId, {
              text: 'Fetched data, processing...',
              loading: true,
            })
            break

          case ChatEventType.ToolCallError:
            updateMessage(assistantId, {
              text: `${event.toolName} failed: ${event.error}`,
              loading: false,
            })
            break

          case ChatEventType.DataProcessing:
            updateMessage(assistantId, {
              text: 'Processing data...',
              loading: true,
            })
            break

          case ChatEventType.StructuredReady:
            // Focus/merge finished — update main panel before text streaming starts
            if (hasUsableStructuredData(event.structured)) {
              const ok = updateMainView(event.structured.data, url)
              if (ok) {
                mainPanelUpdated = true
                autoSelectTab(event.structured.data, '')
                scrollToResponseData()
              }
            }
            updateMessage(assistantId, {
              text: 'Generating response...',
              loading: true,
            })
            break

          default:
            break
        }
      })

      const structuredUsable = hasUsableStructuredData(result.structured)

      updateMessage(assistantId, {
        text: result.text,
        loading: false,
        ...(result.toolResults.length > 0 ? { toolResults: result.toolResults } : {}),
        ...(structuredUsable ? { structured: result.structured } : {}),
      })

      // Fallback: update main panel if StructuredReady didn't fire (sequential mode or merge failed)
      if (!mainPanelUpdated) {
        const lastToolResult = result.toolResults.at(-1)
        const viewData = structuredUsable ? result.structured.data : lastToolResult?.data
        if (viewData !== undefined) {
          const ok = updateMainView(viewData, url)
          if (ok) {
            autoSelectTab(viewData, result.text)
            scrollToResponseData()
          }
        }
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
  }, [url, config, sending, addMessage, updateMessage, setSending, setChatApiUrl, getEngine])

  // Approximate context size for the UI indicator
  const history = engineRef.current?.getHistory() ?? []
  const contextStats = {
    messageCount: history.length,
    estimatedTokens: Math.ceil(
      history.reduce((sum, m) => sum + (m.content?.length || 0), 0) / 4
    ),
  }

  return {
    messages,
    sendMessage,
    clearMessages,
    sending,
    hasApiKey: !!config.apiKey,
    contextStats,
    llmHistory: history as import('@api2aux/chat-engine').ChatMessage[],
    callLog,
  }
}
