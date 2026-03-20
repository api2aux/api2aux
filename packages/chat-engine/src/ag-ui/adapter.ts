/**
 * AG-UI protocol adapter for ChatEngine.
 *
 * Maps ChatEngine events to AG-UI event stream.
 * Returns an AsyncIterable<AgUiEvent> — no RxJS dependency.
 * Transport-agnostic: consumers pipe to SSE, WebSocket, etc.
 */

import type { ChatEngine } from '../engine'
import type { ChatEngineEvent } from '../types'
import { ChatEventType, MergeStrategy } from '../types'
import { TRUNCATION_LIMIT } from '../defaults'
import type {
  AgUiEvent,
  AgUiRunInput,
  AgUiStateSnapshot,
  AgUiRunStartedEvent,
  AgUiRunFinishedEvent,
  AgUiRunErrorEvent,
  AgUiTextMessageEndEvent,
} from './types'
import { AgUiEventType, AgUiRole } from './types'

/** Generate a unique message ID scoped to a single adapter run. */
function nextId(state: AdapterState): string {
  return `msg_${Date.now()}_${++state.idCounter}`
}

function now(): number {
  return Date.now()
}

/** Per-run state for the AG-UI adapter's event mapping. */
export interface AdapterState {
  messageId: string | null
  toolCallCounter: number
  toolCallIdMap: Map<string, string>
  idCounter: number
}

export function createAdapterState(): AdapterState {
  return { messageId: null, toolCallCounter: 0, toolCallIdMap: new Map(), idCounter: 0 }
}

/**
 * Map a single ChatEngineEvent to one or more AG-UI events.
 * Manages messageId lifecycle for text message streaming.
 * Translates the engine's toolCallId to AG-UI sequential IDs (tc_1, tc_2, ...) via a mapping table.
 */
export function mapEvent(
  event: ChatEngineEvent,
  state: AdapterState,
  threadId: string,
  runId: string,
): AgUiEvent[] {
  const events: AgUiEvent[] = []

  switch (event.type) {
    case ChatEventType.Token: {
      if (!state.messageId) {
        state.messageId = nextId(state)
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
      // Emit all args in a single delta (this engine receives them already assembled, not streamed incrementally)
      let argsJson: string
      try {
        argsJson = JSON.stringify(event.toolArgs)
      } catch (err) {
        console.warn('[chat-engine] Failed to serialize toolArgs for', event.toolName, ':', err instanceof Error ? err.message : String(err))
        argsJson = '{}'
      }
      events.push({
        type: AgUiEventType.ToolCallArgs,
        toolCallId: agUiToolCallId,
        delta: argsJson,
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
      let toolCallId = state.toolCallIdMap.get(event.toolCallId)
      if (!toolCallId) {
        console.warn('[chat-engine] AG-UI adapter: no mapping for toolCallId', event.toolCallId, '— using fallback')
        toolCallId = `tc_${state.toolCallCounter}`
      }
      let content: string
      try {
        const s = JSON.stringify(event.data)
        // AG-UI transport truncation (independent of engine's truncationLimit, which controls what the LLM sees)
        content = s.length <= TRUNCATION_LIMIT ? s : s.slice(0, TRUNCATION_LIMIT) + '... [truncated]'
      } catch (err) {
        console.warn('[chat-engine] Failed to serialize tool result data:', err instanceof Error ? err.message : String(err))
        content = '[Unserializable data]'
      }
      events.push({
        type: AgUiEventType.ToolCallResult,
        messageId: nextId(state),
        toolCallId,
        content,
        role: AgUiRole.Tool,
        timestamp: now(),
      })
      break
    }

    case ChatEventType.ToolCallError: {
      let toolCallId = state.toolCallIdMap.get(event.toolCallId)
      if (!toolCallId) {
        console.warn('[chat-engine] AG-UI adapter: no mapping for toolCallId', event.toolCallId, '— using fallback')
        toolCallId = `tc_${state.toolCallCounter}`
      }
      events.push({
        type: AgUiEventType.ToolCallResult,
        messageId: nextId(state),
        toolCallId,
        content: `Error: ${event.error}`,
        role: AgUiRole.Tool,
        timestamp: now(),
      })
      break
    }

    case ChatEventType.StructuredReady: {
      // Early STATE_SNAPSHOT with structured data only (text still streaming)
      let snapshot: AgUiStateSnapshot
      try {
        snapshot = JSON.parse(JSON.stringify({
          text: '',
          toolResults: [],
          structured: event.structured,
        })) as AgUiStateSnapshot
      } catch (err) {
        console.warn('[chat-engine] Failed to serialize early state snapshot:', err instanceof Error ? err.message : String(err))
        snapshot = { text: '', toolResults: [], structured: { strategy: MergeStrategy.Array, sources: [], data: [] }, degraded: true }
      }
      events.push({
        type: AgUiEventType.StateSnapshot,
        snapshot,
        timestamp: now(),
      })
      break
    }

    case ChatEventType.TurnComplete: {
      if (state.messageId) {
        events.push({
          type: AgUiEventType.TextMessageEnd,
          messageId: state.messageId,
          timestamp: now(),
        })
      }

      // Serialization guard: ensure snapshot data is JSON-safe for transport
      let snapshot: AgUiStateSnapshot
      try {
        snapshot = JSON.parse(JSON.stringify({
          text: event.text,
          toolResults: event.toolResults,
          structured: event.structured,
        })) as AgUiStateSnapshot
      } catch (err) {
        console.warn('[chat-engine] Failed to serialize state snapshot:', err instanceof Error ? err.message : String(err))
        snapshot = { text: event.text, toolResults: [], structured: { strategy: MergeStrategy.Array, sources: [], data: [] }, degraded: true }
      }

      events.push({
        type: AgUiEventType.StateSnapshot,
        snapshot,
        timestamp: now(),
      })

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
 * Single-consumer only: concurrent .next() calls are not supported.
 */
function createEventQueue<T>() {
  const buffer: T[] = []
  let resolve: ((value: IteratorResult<T>) => void) | null = null
  let done = false

  return {
    push(item: T) {
      if (done) return // Guard against late events after finish
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
          if (resolve) throw new Error('EventQueue: concurrent .next() calls are not supported')
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
 * If the AG-UI input provides tools, they permanently replace the engine's
 * current tool set (via setContext). This affects all subsequent runs, not just the current one.
 */
export function createAgent(engine: ChatEngine): AgUiAgent {
  return {
    run(input: AgUiRunInput): AsyncIterable<AgUiEvent> {
      const { threadId, runId, messages, tools } = input

      if (tools && tools.length > 0) {
        const currentContext = engine.getContext()
        engine.setContext({ ...currentContext, tools })
      }

      const userMessage = messages
        ?.filter(m => m.role === AgUiRole.User)
        .pop()
        ?.content

      if (!userMessage) {
        return {
          async *[Symbol.asyncIterator]() {
            const started: AgUiRunStartedEvent = {
              type: AgUiEventType.RunStarted,
              threadId,
              runId,
              timestamp: now(),
            }
            yield started
            const error: AgUiRunErrorEvent = {
              type: AgUiEventType.RunError,
              message: 'No user message found in AG-UI input',
              timestamp: now(),
            }
            yield error
            const finished: AgUiRunFinishedEvent = {
              type: AgUiEventType.RunFinished,
              threadId,
              runId,
              timestamp: now(),
            }
            yield finished
          },
        }
      }

      const queue = createEventQueue<AgUiEvent>()

      const state = createAdapterState()

      const runStarted: AgUiRunStartedEvent = {
        type: AgUiEventType.RunStarted,
        threadId,
        runId,
        timestamp: now(),
      }
      queue.push(runStarted)

      let errorEmitted = false
      engine.sendMessage(userMessage, (event) => {
        if (event.type === ChatEventType.Error) errorEmitted = true
        const mapped = mapEvent(event, state, threadId, runId)
        for (const e of mapped) queue.push(e)
      }).then(() => {
        queue.finish()
      }).catch((err) => {
        // Only emit RunError if the engine didn't already emit one via ChatEventType.Error
        if (!errorEmitted) {
          const runError: AgUiRunErrorEvent = {
            type: AgUiEventType.RunError,
            message: err instanceof Error ? err.message : String(err),
            timestamp: now(),
          }
          queue.push(runError)
        }
        // Close any in-progress text message
        if (state.messageId) {
          const msgEnd: AgUiTextMessageEndEvent = {
            type: AgUiEventType.TextMessageEnd,
            messageId: state.messageId,
            timestamp: now(),
          }
          queue.push(msgEnd)
        }
        const runFinished: AgUiRunFinishedEvent = {
          type: AgUiEventType.RunFinished,
          threadId,
          runId,
          timestamp: now(),
        }
        queue.push(runFinished)
        queue.finish()
      })

      return queue
    },
  }
}
