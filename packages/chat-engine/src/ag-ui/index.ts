/**
 * AG-UI protocol adapter for @api2aux/chat-engine.
 * Maps ChatEngine events to the AG-UI event stream protocol.
 */

// === Types ===
export type {
  AgUiBaseEvent,
  AgUiRunStartedEvent,
  AgUiRunFinishedEvent,
  AgUiRunErrorEvent,
  AgUiTextMessageStartEvent,
  AgUiTextMessageContentEvent,
  AgUiTextMessageEndEvent,
  AgUiToolCallStartEvent,
  AgUiToolCallArgsEvent,
  AgUiToolCallEndEvent,
  AgUiToolCallResultEvent,
  AgUiStateSnapshotEvent,
  AgUiEvent,
  AgUiRunInput,
} from './types'

export { AgUiEventType, AgUiRole } from './types'

// === Adapter ===
export type { AgUiAgent } from './adapter'
export { createAgent, mapEvent } from './adapter'
