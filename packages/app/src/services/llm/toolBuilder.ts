/**
 * Wrappers around @api2aux/chat-engine context building functions.
 *
 * Not currently imported by any consumer — the app's useChat hook imports
 * buildChatContext from the engine directly. Retained for standalone usage
 * outside the chat flow (e.g. building tools without a full ChatEngineContext).
 *
 * buildToolsFromUrl is wrapped to auto-parse URL parameters (since
 * parseUrlParameters lives in the app, not the engine).
 */

import { buildToolsFromSpec, buildSystemPrompt } from '@api2aux/chat-engine'
import { buildToolsFromUrl as engineBuildToolsFromUrl } from '@api2aux/chat-engine'
import { parseUrlParameters } from '../urlParser/parser'
import type { Tool } from './types'

export { buildToolsFromSpec, buildSystemPrompt }

/**
 * Build tools from a raw API URL (non-OpenAPI).
 * Wraps the engine's buildToolsFromUrl with auto URL parameter parsing.
 */
export function buildToolsFromUrl(url: string): Tool[] {
  const { parameters } = parseUrlParameters(url)
  return engineBuildToolsFromUrl(url, parameters)
}
