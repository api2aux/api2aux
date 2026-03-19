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
import { buildChatContext, ChatEngine, ChatEventType, MergeStrategy } from '@api2aux/chat-engine'
import type { LLMCompletionFn, ToolExecutorFn, ChatEngineEvent } from '@api2aux/chat-engine'
import { generateToolName } from '@api2aux/tool-utils'
import { parseUrlParameters } from '../services/urlParser/parser'
import { useParameterStore } from '../store/parameterStore'
import { fetchWithAuth, credentialToAuth } from '../services/api/fetcher'
import { executeOperation } from 'api-invoke'
import { proxy } from '../services/api/proxy'
import { useAuthStore } from '../store/authStore'
import { inferSchema } from '../services/schema/inferrer'
import type { UIMessage } from '../services/llm/types'

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

function createToolExecutor(apiUrl: string): ToolExecutorFn {
  return async (toolName: string, args: Record<string, unknown>): Promise<unknown> => {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(apiUrl)
    } catch {
      throw new Error(`Invalid API URL "${apiUrl}". Please check the URL includes a protocol (e.g., https://).`)
    }
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname.replace(/\/$/, '')}`

    if (toolName === 'query_api') {
      const queryParams = new URLSearchParams(parsedUrl.search)
      for (const [key, value] of Object.entries(args)) {
        if (value !== undefined && value !== '') {
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
}

// ── Hook ──

export function useChat() {
  const url = useAppStore((s) => s.url)
  const parsedSpec = useAppStore((s) => s.parsedSpec)
  const { messages, addMessage, updateMessage, clearMessages: storeClearMessages, config, sending, setSending, setChatApiUrl } = useChatStore()

  const engineRef = useRef<ChatEngine | null>(null)

  // Create LLM function by closing over config
  const llmFn: LLMCompletionFn = useMemo(() => {
    return (messages, tools, onToken) =>
      chatCompletionStream(messages, tools, config, onToken)
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
        mergeStrategy: MergeStrategy.Array, // UI handles rendering; array is simplest
      })
    } else {
      // Clear stale history when switching to a different API
      if (engineRef.current.getContext().url !== context.url) {
        engineRef.current.clearHistory()
      }
      engineRef.current.setContext(context)
      engineRef.current.setLlm(llmFn)
      engineRef.current.setExecutor(createToolExecutor(url))
    }
    return engineRef.current
  }, [url, context, llmFn])

  const clearMessages = useCallback(() => {
    storeClearMessages()
    engineRef.current?.clearHistory()
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

    try {
      const result = await engine.sendMessage(text.trim(), (event: ChatEngineEvent) => {
        switch (event.type) {
          case ChatEventType.Token:
            streamedText += event.token
            updateMessage(assistantId, { text: streamedText })
            break

          case ChatEventType.ToolCallStart:
            streamedText = '' // Reset for next round to prevent cross-round text accumulation
            updateMessage(assistantId, {
              text: `Calling ${event.toolName}...${event.parallelCount > 1 ? ` (${event.parallelCount} parallel calls)` : ''}`,
              toolName: event.toolName,
              toolArgs: event.toolArgs,
            })
            syncOperationUI(event.toolName, event.toolArgs)
            break

          case ChatEventType.ToolCallResult: {
            try {
              const toolSchema = inferSchema(event.data, url)
              useAppStore.getState().fetchSuccess(event.data, toolSchema)
            } catch (err) {
              console.error('[useChat] Failed to update main view:', err instanceof Error ? err.message : String(err))
            }

            addMessage({
              id: nextId(),
              role: 'tool-result',
              text: `${event.summary} — updated main view`,
              toolName: event.toolName,
              toolArgs: event.toolArgs,
              timestamp: Date.now(),
            })
            break
          }

          case ChatEventType.ToolCallError:
            addMessage({
              id: nextId(),
              role: 'tool-result',
              text: `${event.toolName} failed: ${event.error}`,
              toolName: event.toolName,
              toolArgs: event.toolArgs,
              timestamp: Date.now(),
            })
            break
        }
      })

      updateMessage(assistantId, {
        text: result.text,
        loading: false,
        ...(result.toolResults.length > 0 ? { toolResults: result.toolResults } : {}),
      })

      // Auto-select the most relevant tab based on the response text
      if (result.toolResults.length > 0) {
        const lastData = result.toolResults[result.toolResults.length - 1]!.data
        autoSelectTab(lastData, result.text)
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
  }
}
