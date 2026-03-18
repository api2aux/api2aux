/**
 * ChatEngine — the core conversation loop.
 *
 * Manages multi-round LLM tool calling, event emission, plugin hooks,
 * and the no-LLM-knowledge guardrail.
 */

import type {
  ChatMessage,
  LLMCompletionFn,
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
import { MAX_ROUNDS, TRUNCATION_LIMIT, NO_DATA_MESSAGE } from './defaults'
import { truncateToolResult, summarizeToolResult } from './truncation'
import { formatStructuredResponse } from './response'

export class ChatEngine {
  private history: ChatMessage[] = []
  private llm: LLMCompletionFn
  private executor: ToolExecutorFn
  private context: ChatEngineContext
  private plugins: ChatEnginePlugin[] | undefined
  private readonly maxRounds: number
  private readonly truncationLimit: number
  private readonly mergeStrategy: MergeStrategy

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
  }

  /** Get current conversation history (read-only view of the live array). */
  getHistory(): readonly ChatMessage[] {
    return this.history
  }

  /** Get current context. */
  getContext(): ChatEngineContext {
    return this.context
  }

  /** Update the LLM function (e.g., when user changes model/provider/API key). */
  setLlm(llm: LLMCompletionFn): void {
    this.llm = llm
  }

  /** Clear conversation history. */
  clearHistory(): void {
    this.history = []
  }

  /** Replace conversation history (for restoring from persistence). */
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
    // 1. Push user message to history
    this.history.push({ role: MessageRole.User, content: text.trim() })

    // Apply plugin hooks
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

    // 3. Tool-calling loop
    let roundCount = 0
    const collectedResults: ToolResultEntry[] = []

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const llmMessages: ChatMessage[] = [
        { role: MessageRole.System, content: systemPrompt },
        ...this.history,
      ]

      // On last allowed round, send no tools to force a text response
      const roundTools = roundCount >= this.maxRounds ? [] : tools

      // Stream the response
      let streamedText = ''
      let streamResult
      try {
        streamResult = await this.llm(
          llmMessages,
          roundTools,
          (token) => {
            streamedText += token
            onEvent({ type: ChatEventType.Token, token })
          },
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        onEvent({ type: ChatEventType.Error, error: errorMsg })
        throw err
      }

      // If no tool calls, this was the final text response
      if (streamResult.tool_calls.length === 0) {
        let responseText = streamResult.content || 'Done.'

        // Guardrail: override response when no tool calls succeeded
        if (collectedResults.length === 0) {
          responseText = NO_DATA_MESSAGE
        }

        // Apply plugin processResponse hooks
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

        // 5. Format structured response
        const structured = await this.buildStructuredResponse(
          collectedResults,
          text,
        )

        onEvent({
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

      // Tool calls returned — execute them, then loop
      roundCount++
      const allToolCalls = streamResult.tool_calls

      // Track assistant message with tool_calls in history
      this.history.push({
        role: MessageRole.Assistant,
        content: null,
        tool_calls: allToolCalls,
      })

      // Execute all tool calls
      for (const toolCall of allToolCalls) {
        let toolArgs: Record<string, unknown>
        try {
          toolArgs = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
        } catch (parseErr) {
          const parseDetail = parseErr instanceof Error ? parseErr.message : ''
          const errorMsg = `Invalid JSON in tool arguments (${parseDetail}): ${toolCall.function.arguments}`
          this.history.push({
            role: MessageRole.Tool,
            content: `Error: ${errorMsg}`,
            tool_call_id: toolCall.id,
          })
          onEvent({
            type: ChatEventType.ToolCallError,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            toolArgs: {},
            error: errorMsg,
          })
          continue
        }

        onEvent({
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
          onEvent({
            type: ChatEventType.ToolCallError,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            toolArgs,
            error: errorMsg,
          })
          continue
        }

        // Apply plugin processToolResult hooks
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

        onEvent({
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

  /** Build the structured response using the configured merge strategy. */
  private async buildStructuredResponse(
    toolResults: ToolResultEntry[],
    userMessage: string,
  ): Promise<StructuredResponse> {
    return formatStructuredResponse(
      toolResults,
      this.mergeStrategy,
      userMessage,
      this.llm,
    )
  }
}
