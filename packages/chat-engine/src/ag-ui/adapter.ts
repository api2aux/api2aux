/**
 * AG-UI protocol adapter for ChatEngine.
 *
 * Maps ChatEngine events to AG-UI event stream.
 * Returns an AsyncIterable<AgUiEvent> — no RxJS dependency.
 * Transport-agnostic: consumers pipe to SSE, WebSocket, etc.
 */

import type { ChatEngine } from '../engine'
import type { ChatEngineEvent } from '../types'
import { ChatEventType } from '../types'
import type { AgUiEvent, AgUiRunInput } from './types'
import { AgUiEventType, AgUiRole } from './types'

// Module-scoped counter for generating unique message IDs within a single process lifetime.
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
 * Uses the engine's toolCallId to correlate start/result events via a mapping table.
 */
export function mapEvent(
  event: ChatEngineEvent,
  state: { messageId: string | null; toolCallCounter: number; toolCallIdMap: Map<string, string> },
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
      const agUiToolCallId = `tc_${++state.toolCallCounter}`
      state.toolCallIdMap.set(event.toolCallId, agUiToolCallId)
      events.push({
        type: AgUiEventType.ToolCallStart,
        toolCallId: agUiToolCallId,
        toolCallName: event.toolName,
        parentMessageId: state.messageId ?? undefined,
        timestamp: now(),
      })
      // Emit args atomically (not streamed)
      events.push({
        type: AgUiEventType.ToolCallArgs,
        toolCallId: agUiToolCallId,
        delta: JSON.stringify(event.toolArgs),
        timestamp: now(),
      })
      events.push({
        type: AgUiEventType.ToolCallEnd,
        toolCallId: agUiToolCallId,
        timestamp: now(),
      })
      break
    }

    case ChatEventType.ToolCallResult: {
      const toolCallId = state.toolCallIdMap.get(event.toolCallId) ?? `tc_${state.toolCallCounter}`
      events.push({
        type: AgUiEventType.ToolCallResult,
        messageId: nextId(),
        toolCallId,
        content: (() => { const s = JSON.stringify(event.data); return s.length <= 8000 ? s : s.slice(0, 8000) + '... [truncated]' })(),
        role: AgUiRole.Tool,
        timestamp: now(),
      })
      break
    }

    case ChatEventType.ToolCallError: {
      const toolCallId = state.toolCallIdMap.get(event.toolCallId) ?? `tc_${state.toolCallCounter}`
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
 * Simple async queue for bridging synchronous callbacks to async iterators.
 * The onEvent callback pushes events; the async iterator pulls them.
 */
function createEventQueue<T>() {
  const buffer: T[] = []
  let resolve: ((value: IteratorResult<T>) => void) | null = null
  let done = false

  return {
    push(item: T) {
      if (resolve) {
        resolve({ value: item, done: false })
        resolve = null
      } else {
        buffer.push(item)
      }
    },
    finish() {
      done = true
      if (resolve) {
        resolve({ value: undefined as unknown as T, done: true })
        resolve = null
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false })
          }
          if (done) {
            return Promise.resolve({ value: undefined as unknown as T, done: true })
          }
          return new Promise(r => { resolve = r })
        },
      }
    },
  }
}

/**
 * Create an AG-UI compatible agent from a ChatEngine.
 *
 * Frontend tools in AgUiRunInput use the same OpenAI function-calling Tool
 * format as the engine, so they can be passed through directly.
 */
export function createAgent(engine: ChatEngine): AgUiAgent {
  return {
    run(input: AgUiRunInput): AsyncIterable<AgUiEvent> {
      const { threadId, runId, messages, tools } = input

      // If AG-UI input provides tools, update the engine context
      if (tools && tools.length > 0) {
        const currentContext = engine.getContext()
        engine.setContext({ ...currentContext, tools })
      }

      // Extract the latest user message from AG-UI messages
      const userMessage = messages
        ?.filter(m => m.role === AgUiRole.User)
        .pop()
        ?.content

      if (!userMessage) {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: AgUiEventType.RunError,
              message: 'No user message found in AG-UI input',
              timestamp: now(),
            } as AgUiEvent
          },
        }
      }

      const queue = createEventQueue<AgUiEvent>()

      // Start the engine in the background; events stream through the queue
      const state = { messageId: null as string | null, toolCallCounter: 0, toolCallIdMap: new Map<string, string>() }

      // Emit RUN_STARTED immediately
      queue.push({
        type: AgUiEventType.RunStarted,
        threadId,
        runId,
        timestamp: now(),
      } as AgUiEvent)

      engine.sendMessage(userMessage, (event) => {
        const mapped = mapEvent(event, state, threadId, runId)
        for (const e of mapped) queue.push(e)
      }).then(() => {
        queue.finish()
      }).catch((err) => {
        queue.push({
          type: AgUiEventType.RunError,
          message: err instanceof Error ? err.message : String(err),
          timestamp: now(),
        } as AgUiEvent)
        queue.finish()
      })

      return queue
    },
  }
}
