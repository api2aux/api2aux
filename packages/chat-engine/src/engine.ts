/**
 * ChatEngine — the core conversation loop.
 *
 * Manages multi-round LLM tool calling, event emission, plugin hooks,
 * and a no-knowledge guardrail (replaces the LLM's response with a fallback
 * message when no tool calls returned usable data during the turn).
 */

import type {
  ChatMessage,
  LLMCompletionFn,
  LLMTextFn,
  ToolExecutorFn,
  ChatEngineContext,
  ChatEngineConfig,
  ChatEngineEventHandler,
  ChatEngineResponse,
  ChatEnginePlugin,
  ToolResultEntry,
  StructuredResponse,
} from './types'
import { ChatEventType, MergeStrategy, MessageRole } from './types'
import { MAX_ROUNDS, TRUNCATION_LIMIT, PARALLEL_MERGE, NO_DATA_MESSAGE } from './defaults'
import { truncateToolResult, summarizeToolResult } from './truncation'
import { formatStructuredResponse } from './response'

export class ChatEngine {
  private history: ChatMessage[] = []
  private busy = false
  private llm: LLMCompletionFn
  private executor: ToolExecutorFn
  private context: ChatEngineContext
  private plugins: ChatEnginePlugin[] | undefined
  private readonly maxRounds: number
  private readonly truncationLimit: number
  private readonly mergeStrategy: MergeStrategy
  private readonly parallelMerge: boolean
  private llmText: LLMTextFn | undefined

  constructor(
    llm: LLMCompletionFn,
    executor: ToolExecutorFn,
    context: ChatEngineContext,
    config?: ChatEngineConfig,
    plugins?: ChatEnginePlugin[],
  ) {
    this.llm = llm
    this.executor = executor
    this.context = context
    this.plugins = plugins
    this.maxRounds = config?.maxRounds ?? MAX_ROUNDS

    // Validate plugin IDs are unique
    if (plugins) {
      const ids = new Set<string>()
      for (const p of plugins) {
        if (ids.has(p.id)) throw new Error(`Duplicate plugin id: ${p.id}`)
        ids.add(p.id)
      }
    }
    this.truncationLimit = config?.truncationLimit ?? TRUNCATION_LIMIT
    this.mergeStrategy = config?.mergeStrategy ?? MergeStrategy.LlmGuided
    this.parallelMerge = config?.parallelMerge ?? PARALLEL_MERGE
    this.llmText = config?.llmText

    if (this.parallelMerge && !this.llmText && this.mergeStrategy === MergeStrategy.LlmGuided) {
      console.warn('[chat-engine] parallelMerge is enabled with LlmGuided strategy but llmText is not provided — merge calls will reuse the streaming LLM with a no-op token handler')
    }

    // Validate resolved config values
    if (!Number.isFinite(this.maxRounds) || this.maxRounds < 1) {
      throw new Error(`ChatEngineConfig: maxRounds must be a finite number >= 1, got ${this.maxRounds}`)
    }
    if (!Number.isFinite(this.truncationLimit) || this.truncationLimit < 1) {
      throw new Error(`ChatEngineConfig: truncationLimit must be a finite number >= 1, got ${this.truncationLimit}`)
    }
  }

  /** Get a shallow copy of the current conversation history. Message objects are shared references; do not mutate them. */
  getHistory(): readonly ChatMessage[] {
    return [...this.history]
  }

  getContext(): ChatEngineContext {
    return this.context
  }

  /** Get the resolved engine configuration. */
  getConfig(): Readonly<Required<Omit<ChatEngineConfig, 'llmText'>>> {
    return {
      maxRounds: this.maxRounds,
      truncationLimit: this.truncationLimit,
      mergeStrategy: this.mergeStrategy,
      parallelMerge: this.parallelMerge,
    }
  }

  /** Update the LLM function (e.g., when user changes model/provider/API key). */
  setLlm(llm: LLMCompletionFn): void {
    this.llm = llm
  }

  /** Update the non-streaming LLM function used for merge/focus calls. */
  setLlmText(llmText: LLMTextFn | undefined): void {
    this.llmText = llmText
  }

  /** Update the tool executor (e.g., when user changes API URL). */
  setExecutor(executor: ToolExecutorFn): void {
    this.executor = executor
  }

  clearHistory(): void {
    this.history = []
  }

  /**
   * Replace conversation history (for restoring from persistence).
   * Caller is responsible for structural validity: tool messages must reference
   * a preceding assistant message's tool_call IDs, etc.
   */
  setHistory(history: ChatMessage[]): void {
    this.history = [...history]
  }

  /** Update context (e.g., when user changes API or spec). */
  setContext(context: ChatEngineContext): void {
    this.context = context
  }

  /**
   * Send a user message and run the full conversation loop.
   * Streams events to the handler as they occur.
   * Returns the final response when the turn is complete.
   */
  async sendMessage(
    text: string,
    onEvent: ChatEngineEventHandler,
  ): Promise<ChatEngineResponse> {
    if (this.busy) throw new Error('ChatEngine: sendMessage is already in progress')
    this.busy = true

    try {
      return await this.runConversation(text, onEvent)
    } finally {
      this.busy = false
    }
  }

  private async runConversation(
    text: string,
    onEvent: ChatEngineEventHandler,
  ): Promise<ChatEngineResponse> {
    // Wrap the event handler to prevent callback errors from crashing the engine loop
    const emit: ChatEngineEventHandler = (event) => {
      try { onEvent(event) } catch (err) {
        console.error('[chat-engine] onEvent handler threw:', err instanceof Error ? err.stack ?? err.message : String(err))
      }
    }

    const trimmed = text.trim()
    if (trimmed.length === 0) throw new Error('ChatEngine: message text must not be empty')
    this.history.push({ role: MessageRole.User, content: trimmed })

    let systemPrompt = this.context.systemPrompt
    for (const plugin of this.plugins ?? []) {
      if (plugin.modifySystemPrompt) {
        try {
          const modified = plugin.modifySystemPrompt(systemPrompt, this.context)
          if (modified !== null) systemPrompt = modified
        } catch (err) {
          console.error(`[chat-engine] Plugin "${plugin.id}" modifySystemPrompt threw:`, err instanceof Error ? err.message : String(err))
        }
      }
    }

    // Note: if a plugin throws here, the tools from the last successful plugin
    // (or the original tools) are used. For security-critical plugins (e.g. tool
    // filtering to restrict access), plugins should catch internally.
    let tools = [...this.context.tools]
    for (const plugin of this.plugins ?? []) {
      if (plugin.modifyTools) {
        try {
          tools = plugin.modifyTools(tools, this.context)
        } catch (err) {
          console.error(`[chat-engine] Plugin "${plugin.id}" modifyTools threw:`, err instanceof Error ? err.message : String(err))
        }
      }
    }

    let roundCount = 0
    const collectedResults: ToolResultEntry[] = []
    let mergePromise: Promise<StructuredResponse> | null = null
    // Generation counter: prevents stale merge promises from emitting StructuredReady
    let mergeGeneration = 0

    // Loop until the LLM produces a text response (no tool calls)
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const llmMessages: ChatMessage[] = [
        { role: MessageRole.System, content: systemPrompt },
        ...this.history,
      ]

      // After max tool-calling rounds, send no tools to force a text response
      const roundTools = roundCount >= this.maxRounds ? [] : tools

      let streamedText = ''
      let mergeStarted = false
      let streamResult
      try {
        streamResult = await this.llm(
          llmMessages,
          roundTools,
          (token) => {
            streamedText += token
            emit({ type: ChatEventType.Token, token })

            // On first token: confirmed this is a text response (not tool calls).
            // Start merge/focus in parallel while text continues streaming.
            if (!mergeStarted && this.parallelMerge && collectedResults.length > 0) {
              mergeStarted = true
              const gen = ++mergeGeneration
              mergePromise = this.buildStructuredResponse(collectedResults, text)
              mergePromise.then(structured => {
                // Only emit if this is still the latest merge (not superseded by a later round)
                if (gen === mergeGeneration) {
                  emit({ type: ChatEventType.StructuredReady, structured })
                }
              }).catch(() => {
                // Handled when mergePromise is awaited below; this prevents unhandled-rejection warnings.
              })
            }
          },
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        emit({ type: ChatEventType.Error, error: errorMsg })
        throw err
      }

      if (streamResult.tool_calls.length === 0) {
        let responseText = streamResult.content || 'Done.'

        // No-knowledge guardrail: no tool call returned usable data this turn
        if (collectedResults.length === 0) {
          responseText = NO_DATA_MESSAGE
        }

        for (const plugin of this.plugins ?? []) {
          if (plugin.processResponse) {
            try {
              responseText = plugin.processResponse(responseText, collectedResults)
            } catch (err) {
              console.error(`[chat-engine] Plugin "${plugin.id}" processResponse threw:`, err instanceof Error ? err.message : String(err))
            }
          }
        }

        this.history.push({ role: MessageRole.Assistant, content: responseText })

        // Await the parallel merge (already in-flight) or run sequentially
        let structured: StructuredResponse
        try {
          structured = await (mergePromise ?? this.buildStructuredResponse(collectedResults, text))
        } catch (err) {
          console.error('[chat-engine] buildStructuredResponse failed:', err instanceof Error ? err.message : String(err))
          structured = {
            strategy: MergeStrategy.Array,
            sources: collectedResults.map(r => ({ toolName: r.toolName, toolArgs: r.toolArgs })),
            data: collectedResults.map(r => r.data),
          }
        }

        // Compress tool results in history now that we have focused data
        this.compressToolHistory(collectedResults, structured)

        emit({
          type: ChatEventType.TurnComplete,
          text: responseText,
          toolResults: collectedResults,
          structured,
        })

        return {
          text: responseText,
          toolResults: collectedResults,
          structured,
          history: [...this.history],
        }
      }

      roundCount++
      const allToolCalls = streamResult.tool_calls

      this.history.push({
        role: MessageRole.Assistant,
        content: null,
        tool_calls: allToolCalls,
      })

      for (const toolCall of allToolCalls) {
        let toolArgs: Record<string, unknown>
        try {
          toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
        } catch (parseErr) {
          const parseDetail = parseErr instanceof Error ? parseErr.message : ''
          const errorMsg = `Invalid JSON in tool arguments (${parseDetail}): ${toolCall.function.arguments}`
          // Emit ToolCallStart so consumers always see a start before an error
          emit({
            type: ChatEventType.ToolCallStart,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            toolArgs: {},
            parallelCount: allToolCalls.length,
          })
          this.history.push({
            role: MessageRole.Tool,
            content: `Error: ${errorMsg}`,
            tool_call_id: toolCall.id,
          })
          emit({
            type: ChatEventType.ToolCallError,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            toolArgs: {},
            error: errorMsg,
          })
          continue
        }

        emit({
          type: ChatEventType.ToolCallStart,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          toolArgs,
          parallelCount: allToolCalls.length,
        })

        let toolResult: unknown
        try {
          toolResult = await this.executor(toolCall.function.name, toolArgs)
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          this.history.push({
            role: MessageRole.Tool,
            content: `Error: ${errorMsg}`,
            tool_call_id: toolCall.id,
          })
          emit({
            type: ChatEventType.ToolCallError,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            toolArgs,
            error: errorMsg,
          })
          continue
        }

        // Note: if a plugin throws here, its transform is skipped and the last
        // successfully-transformed value is used. For safety-critical plugins
        // (e.g. PII redaction), plugins should catch internally.
        for (const plugin of this.plugins ?? []) {
          if (plugin.processToolResult) {
            try {
              toolResult = plugin.processToolResult(toolCall.function.name, toolResult)
            } catch (err) {
              console.error(`[chat-engine] Plugin "${plugin.id}" processToolResult threw:`, err instanceof Error ? err.message : String(err))
            }
          }
        }

        const summary = summarizeToolResult(toolResult, toolCall.function.name, toolArgs)
        collectedResults.push({
          toolName: toolCall.function.name,
          toolArgs,
          data: toolResult,
          summary,
        })

        emit({
          type: ChatEventType.ToolCallResult,
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          toolArgs,
          data: toolResult,
          summary,
        })

        const truncatedResult = truncateToolResult(toolResult, this.truncationLimit)
        this.history.push({
          role: MessageRole.Tool,
          content: truncatedResult,
          tool_call_id: toolCall.id,
        })
      }
    }
  }

  /**
   * Replace raw tool result messages in history with compact focused data + endpoint metadata.
   * Only compresses when focus/merge succeeded (non-Array strategy).
   * The full raw data remains in collectedResults for UI consumption.
   */
  private compressToolHistory(
    collectedResults: ToolResultEntry[],
    structured: StructuredResponse,
  ): void {
    if (structured.strategy === MergeStrategy.Array) return

    const metadata = collectedResults.map(r => ({
      tool: r.toolName,
      args: r.toolArgs,
      summary: r.summary,
    }))

    const compressed = JSON.stringify({
      _compressed: true,
      focused: structured.data,
      calls: metadata,
    })

    // Find tool_call_ids from the most recent assistant tool_calls message
    const toolCallIds = new Set<string>()
    for (let i = this.history.length - 1; i >= 0; i--) {
      const msg = this.history[i]!
      if (msg.role === MessageRole.Assistant && msg.tool_calls) {
        for (const tc of msg.tool_calls) toolCallIds.add(tc.id)
        break
      }
    }

    // Replace tool messages: first gets compressed content,
    // rest get minimal refs (OpenAI format requires one tool msg per tool_call_id)
    let first = true
    for (let i = 0; i < this.history.length; i++) {
      const msg = this.history[i]!
      if (msg.role === MessageRole.Tool && msg.tool_call_id && toolCallIds.has(msg.tool_call_id)) {
        if (first) {
          this.history[i] = { role: MessageRole.Tool, content: compressed, tool_call_id: msg.tool_call_id }
          first = false
        } else {
          this.history[i] = {
            role: MessageRole.Tool,
            content: JSON.stringify({ _ref: 'see first tool result for focused data' }),
            tool_call_id: msg.tool_call_id,
          }
        }
      }
    }
  }

  /** Build the structured response using the configured merge strategy. */
  private async buildStructuredResponse(
    toolResults: ToolResultEntry[],
    userMessage: string,
  ): Promise<StructuredResponse> {
    // Prefer non-streaming LLM for merge/focus — creates a separate HTTP request
    // that resolves independently of the streaming SSE connection.
    // Falls back to wrapping the streaming LLM with a no-op token handler.
    const mergeLlm: LLMTextFn = this.llmText
      ?? (async (messages) => {
          const result = await this.llm(messages, [], () => {})
          return result.content
        })

    return formatStructuredResponse(
      toolResults,
      this.mergeStrategy,
      userMessage,
      mergeLlm,
    )
  }
}
