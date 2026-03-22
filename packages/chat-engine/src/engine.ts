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
import { buildResponsePrompt } from './context'
import { reduceToolResultsForFocus, FocusReduction } from './reduction'
import type { FocusReductionStrategy } from './reduction'

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
  private embedFn: ((texts: string[]) => Promise<number[][]>) | undefined
  private readonly focusReduction: FocusReductionStrategy

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
    this.embedFn = config?.embedFn
    this.focusReduction = config?.focusReduction ?? FocusReduction.TruncateValues

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
  getConfig(): Readonly<Required<Omit<ChatEngineConfig, 'llmText' | 'embedFn' | 'embedTopK' | 'focusReduction'>>> {
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

    // ── Phase A: Tool-calling loop ──
    // LLM calls tools, we execute them. Repeats until LLM stops calling tools.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const llmMessages: ChatMessage[] = [
        { role: MessageRole.System, content: systemPrompt },
        ...this.history,
      ]

      // After max tool-calling rounds, send no tools to force a text response
      const roundTools = roundCount >= this.maxRounds ? [] : tools

      let streamResult
      try {
        streamResult = await this.llm(
          llmMessages,
          roundTools,
          // During tool-calling rounds, ignore streamed text (the LLM is deciding which tools to call).
          // During the forced-text round (maxRounds exceeded, no tools provided), stream tokens directly.
          roundCount >= this.maxRounds
            ? (token) => { emit({ type: ChatEventType.Token, token }) }
            : () => {},
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        emit({ type: ChatEventType.Error, error: errorMsg })
        throw err
      }

      // LLM returned text (no more tool calls)
      if (streamResult.tool_calls.length === 0) {
        // If we have collected tool results, break to Phase B (focus → text response)
        if (collectedResults.length > 0) break

        // No tools were ever called — LLM answered directly or hit guardrail/maxRounds.
        // Return the text response as-is (no focus step needed).
        const responseText = collectedResults.length === 0 ? NO_DATA_MESSAGE : (streamResult.content || 'Done.')
        this.history.push({ role: MessageRole.Assistant, content: responseText })
        const structured = await this.buildArrayFallback(collectedResults)
        emit({ type: ChatEventType.TurnComplete, text: responseText, toolResults: collectedResults, structured })
        return { text: responseText, toolResults: collectedResults, structured, history: [...this.history] }
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

    // ── Phase B: Focus/merge + text response ──
    // Only reached when collectedResults.length > 0 (break condition above).

    // Step 1: Focus/merge the collected tool results
    emit({ type: ChatEventType.DataProcessing })

    let structured: StructuredResponse
    try {
      structured = await this.buildStructuredResponse(collectedResults, text)
    } catch (err) {
      console.error('[chat-engine] buildStructuredResponse failed:', err instanceof Error ? err.message : String(err))
      structured = {
        strategy: MergeStrategy.Array,
        sources: collectedResults.map(r => ({ toolName: r.toolName, toolArgs: r.toolArgs })),
        data: collectedResults.map(r => r.data),
      }
    }

    emit({ type: ChatEventType.StructuredReady, structured })

    // Step 2: Compress tool results in history with focused data
    this.compressToolHistory(collectedResults, structured)

    // Step 3: Generate text response using focused data in history (no tools → forces text)
    // Use a dedicated summarization prompt — Phase B is data presentation, not tool selection
    const responsePrompt = buildResponsePrompt(this.context.url, this.context.spec)
    const responseMessages: ChatMessage[] = [
      { role: MessageRole.System, content: responsePrompt },
      ...this.history,
    ]

    let responseText = ''
    try {
      const streamResult = await this.llm(
        responseMessages,
        [], // No tools — force text response
        (token) => {
          responseText += token
          emit({ type: ChatEventType.Token, token })
        },
      )
      responseText = streamResult.content || responseText || 'Done.'
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      emit({ type: ChatEventType.Error, error: errorMsg })
      throw err
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

  /** Build an Array-strategy fallback response (no focus/merge). */
  private async buildArrayFallback(collectedResults: ToolResultEntry[]): Promise<StructuredResponse> {
    return {
      strategy: MergeStrategy.Array,
      sources: collectedResults.map(r => ({ toolName: r.toolName, toolArgs: r.toolArgs })),
      data: collectedResults.map(r => r.data),
    }
  }

  /**
   * Replace raw tool result messages in history with compact data + endpoint metadata.
   * For LLM-guided/schema-based merges: uses the focused data (already compact).
   * For Array strategy (single result / fallback): uses truncated raw data.
   * The full raw data remains in collectedResults for UI consumption.
   */
  private compressToolHistory(
    collectedResults: ToolResultEntry[],
    structured: StructuredResponse,
  ): void {
    const metadata = collectedResults.map(r => ({
      tool: r.toolName,
      args: r.toolArgs,
      summary: r.summary,
    }))

    const focusedData = structured.strategy === MergeStrategy.Array
      ? collectedResults.map(r => r.data)
      : structured.data

    // Wrap with text framing so the LLM treats it as context data, not something to echo
    const compressed = [
      '[API Result — focused data for the user\'s question]',
      JSON.stringify({ focused: focusedData, calls: metadata }),
      '[End of API Result]',
    ].join('\n')

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
            content: '[See first tool result for focused data]',
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
    // For a single tool result with LlmGuided strategy, skip the focus LLM entirely —
    // apply the reduction strategy locally and return directly. This avoids LLM latency,
    // timeouts, and the LLM's tendency to filter items despite "do NOT filter" instructions.
    // The focus/merge LLM is only useful when combining data from multiple endpoints.
    if (toolResults.length === 1 && this.mergeStrategy === MergeStrategy.LlmGuided) {
      const reducedResults = await reduceToolResultsForFocus(
        toolResults,
        userMessage,
        this.focusReduction,
        this.embedFn,
        this.llmText,
      )
      const reduced = reducedResults[0] ?? toolResults[0]!
      return {
        strategy: MergeStrategy.LlmGuided,
        sources: [{ toolName: toolResults[0]!.toolName, toolArgs: toolResults[0]!.toolArgs }],
        data: reduced.data,
      }
    }

    // Multiple tool results: use the merge LLM to combine them intelligently.
    // Prefer non-streaming LLM — creates a separate HTTP request that resolves
    // independently of the streaming SSE connection.
    const mergeLlm: LLMTextFn = this.llmText
      ?? (async (messages) => {
          const result = await this.llm(messages, [], () => {})
          return result.content
        })

    // Reduce data per strategy before sending to merge LLM
    const reducedResults = await reduceToolResultsForFocus(
      toolResults,
      userMessage,
      this.focusReduction,
      this.embedFn,
      this.llmText,
    )

    return formatStructuredResponse(
      toolResults,
      this.mergeStrategy,
      userMessage,
      mergeLlm,
      reducedResults,
    )
  }
}
