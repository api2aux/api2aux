/**
 * AG-UI protocol adapter for ChatEngine.
 *
 * Maps ChatEngine events to AG-UI event stream.
 * Returns an AsyncIterable<AgUiEvent> — no RxJS dependency.
 * Transport-agnostic: consumers pipe to SSE, WebSocket, etc.
 */

import type { ChatEngine } from '../engine'
import type { ChatEngineEvent, ChatEngineContext } from '../types'
import { ChatEventType } from '../types'
import type { AgUiEvent, AgUiRunInput } from './types'
import { AgUiEventType, AgUiRole } from './types'

let idCounter = 0
function nextId(): string {
  return `msg_${Date.now()}_${++idCounter}`
}

function now(): number {
  return Date.now()
}

/**
 * Map a single ChatEngineEvent to one or more AG-UI events.
 * Manages messageId lifecycle for text message streaming.
 */
export function mapEvent(
  event: ChatEngineEvent,
  state: { messageId: string | null; toolCallCounter: number },
  threadId: string,
  runId: string,
): AgUiEvent[] {
  const events: AgUiEvent[] = []

  switch (event.type) {
    case ChatEventType.Token: {
      // Start a new message if this is the first token
      if (!state.messageId) {
        state.messageId = nextId()
        events.push({
          type: AgUiEventType.TextMessageStart,
          messageId: state.messageId,
          role: AgUiRole.Assistant,
          timestamp: now(),
        })
      }
      events.push({
        type: AgUiEventType.TextMessageContent,
        messageId: state.messageId,
        delta: event.token,
        timestamp: now(),
      })
      break
    }

    case ChatEventType.ToolCallStart: {
      const toolCallId = `tc_${++state.toolCallCounter}`
      events.push({
        type: AgUiEventType.ToolCallStart,
        toolCallId,
        toolCallName: event.toolName,
        parentMessageId: state.messageId ?? undefined,
        timestamp: now(),
      })
      // Emit args atomically (not streamed)
      events.push({
        type: AgUiEventType.ToolCallArgs,
        toolCallId,
        delta: JSON.stringify(event.toolArgs),
        timestamp: now(),
      })
      events.push({
        type: AgUiEventType.ToolCallEnd,
        toolCallId,
        timestamp: now(),
      })
      break
    }

    case ChatEventType.ToolCallResult: {
      const toolCallId = `tc_${state.toolCallCounter}`
      events.push({
        type: AgUiEventType.ToolCallResult,
        messageId: nextId(),
        toolCallId,
        content: JSON.stringify(event.data).slice(0, 8000),
        role: AgUiRole.Tool,
        timestamp: now(),
      })
      break
    }

    case ChatEventType.ToolCallError: {
      const toolCallId = `tc_${state.toolCallCounter}`
      events.push({
        type: AgUiEventType.ToolCallResult,
        messageId: nextId(),
        toolCallId,
        content: `Error: ${event.error}`,
        role: AgUiRole.Tool,
        timestamp: now(),
      })
      break
    }

    case ChatEventType.TurnComplete: {
      // End the text message if one was started
      if (state.messageId) {
        events.push({
          type: AgUiEventType.TextMessageEnd,
          messageId: state.messageId,
          timestamp: now(),
        })
      }

      // Emit state snapshot with structured response and history
      events.push({
        type: AgUiEventType.StateSnapshot,
        snapshot: {
          text: event.text,
          toolResults: event.toolResults,
          structured: event.structured,
        },
        timestamp: now(),
      })

      // Finish the run
      events.push({
        type: AgUiEventType.RunFinished,
        threadId,
        runId,
        timestamp: now(),
      })
      break
    }

    case ChatEventType.Error: {
      events.push({
        type: AgUiEventType.RunError,
        message: event.error,
        timestamp: now(),
      })
      break
    }
  }

  return events
}

/** AG-UI compatible agent interface. */
export interface AgUiAgent {
  run(input: AgUiRunInput): AsyncIterable<AgUiEvent>
}

/**
 * Create an AG-UI compatible agent from a ChatEngine.
 *
 * Frontend tools in AgUiRunInput are passed through to the engine's context
 * since both use the same JSON Schema format ({ name, description, parameters }).
 */
export function createAgent(engine: ChatEngine): AgUiAgent {
  return {
    run(input: AgUiRunInput): AsyncIterable<AgUiEvent> {
      const { threadId, runId, messages, tools } = input

      // If AG-UI input provides tools, update the engine context
      if (tools && tools.length > 0) {
        const currentContext = engine['context'] as ChatEngineContext
        engine.setContext({ ...currentContext, tools })
      }

      // Extract the latest user message from AG-UI messages
      const userMessage = messages
        ?.filter(m => m.role === AgUiRole.User)
        .pop()
        ?.content ?? ''

      return {
        async *[Symbol.asyncIterator]() {
          // Emit RUN_STARTED
          yield {
            type: AgUiEventType.RunStarted,
            threadId,
            runId,
            timestamp: now(),
          } as AgUiEvent

          const state = { messageId: null as string | null, toolCallCounter: 0 }
          const pendingEvents: AgUiEvent[] = []

          try {
            await engine.sendMessage(userMessage, (event) => {
              const mapped = mapEvent(event, state, threadId, runId)
              pendingEvents.push(...mapped)
            })
          } catch (err) {
            yield {
              type: AgUiEventType.RunError,
              message: err instanceof Error ? err.message : String(err),
              timestamp: now(),
            } as AgUiEvent
            return
          }

          // Yield all collected events
          for (const event of pendingEvents) {
            yield event
          }
        },
      }
    },
  }
}
