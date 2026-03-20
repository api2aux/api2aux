/**
 * AG-UI protocol event types and interfaces.
 *
 * Locally defined to avoid depending on @ag-ui/client.
 * Compatible with the AG-UI specification (https://docs.ag-ui.com).
 */

import type { Tool, ToolResultEntry, StructuredResponse } from '../types'

// ── AG-UI Event Types ──

export const AgUiEventType = {
  RunStarted: 'RUN_STARTED',
  RunFinished: 'RUN_FINISHED',
  RunError: 'RUN_ERROR',
  TextMessageStart: 'TEXT_MESSAGE_START',
  TextMessageContent: 'TEXT_MESSAGE_CONTENT',
  TextMessageEnd: 'TEXT_MESSAGE_END',
  ToolCallStart: 'TOOL_CALL_START',
  ToolCallArgs: 'TOOL_CALL_ARGS',
  ToolCallEnd: 'TOOL_CALL_END',
  ToolCallResult: 'TOOL_CALL_RESULT',
  StateSnapshot: 'STATE_SNAPSHOT',
} as const
export type AgUiEventType = typeof AgUiEventType[keyof typeof AgUiEventType]

// ── AG-UI Message Roles ──

export const AgUiRole = {
  Assistant: 'assistant',
  User: 'user',
  System: 'system',
  Tool: 'tool',
} as const
export type AgUiRole = typeof AgUiRole[keyof typeof AgUiRole]

// ── AG-UI Events ──

export interface AgUiBaseEvent {
  type: AgUiEventType
  timestamp?: number
}

export interface AgUiRunStartedEvent extends AgUiBaseEvent {
  type: typeof AgUiEventType.RunStarted
  threadId: string
  runId: string
}

export interface AgUiRunFinishedEvent extends AgUiBaseEvent {
  type: typeof AgUiEventType.RunFinished
  threadId: string
  runId: string
}

export interface AgUiRunErrorEvent extends AgUiBaseEvent {
  type: typeof AgUiEventType.RunError
  message: string
  code?: string
}

export interface AgUiTextMessageStartEvent extends AgUiBaseEvent {
  type: typeof AgUiEventType.TextMessageStart
  messageId: string
  role: AgUiRole
}

export interface AgUiTextMessageContentEvent extends AgUiBaseEvent {
  type: typeof AgUiEventType.TextMessageContent
  messageId: string
  delta: string
}

export interface AgUiTextMessageEndEvent extends AgUiBaseEvent {
  type: typeof AgUiEventType.TextMessageEnd
  messageId: string
}

export interface AgUiToolCallStartEvent extends AgUiBaseEvent {
  type: typeof AgUiEventType.ToolCallStart
  toolCallId: string
  toolCallName: string
  parentMessageId?: string
}

export interface AgUiToolCallArgsEvent extends AgUiBaseEvent {
  type: typeof AgUiEventType.ToolCallArgs
  toolCallId: string
  delta: string
}

export interface AgUiToolCallEndEvent extends AgUiBaseEvent {
  type: typeof AgUiEventType.ToolCallEnd
  toolCallId: string
}

export interface AgUiToolCallResultEvent extends AgUiBaseEvent {
  type: typeof AgUiEventType.ToolCallResult
  messageId: string
  toolCallId: string
  content: string
  role?: AgUiRole
}

/** Snapshot of the engine's turn-end state, sent as the final data event before RunFinished. */
export interface AgUiStateSnapshot {
  text: string
  toolResults: ToolResultEntry[]
  structured: StructuredResponse
  /** True when the snapshot contains fallback data due to a serialization failure. */
  degraded?: boolean
}

export interface AgUiStateSnapshotEvent extends AgUiBaseEvent {
  type: typeof AgUiEventType.StateSnapshot
  snapshot: AgUiStateSnapshot
}

export type AgUiEvent =
  | AgUiRunStartedEvent
  | AgUiRunFinishedEvent
  | AgUiRunErrorEvent
  | AgUiTextMessageStartEvent
  | AgUiTextMessageContentEvent
  | AgUiTextMessageEndEvent
  | AgUiToolCallStartEvent
  | AgUiToolCallArgsEvent
  | AgUiToolCallEndEvent
  | AgUiToolCallResultEvent
  | AgUiStateSnapshotEvent

// ── AG-UI Agent Input ──

export interface AgUiRunInput {
  threadId: string
  runId: string
  messages?: Array<{ role: AgUiRole; content: string }>
  tools?: Tool[]
  context?: unknown
}
