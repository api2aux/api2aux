/**
 * Re-exports context building functions from @api2aux/chat-engine.
 *
 * The app's useChat hook and other consumers continue to import from here,
 * but the actual implementation now lives in the chat-engine package.
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
