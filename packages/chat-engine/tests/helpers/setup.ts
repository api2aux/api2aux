/**
 * Shared setup utilities for functional tests.
 * Loads specs, builds contexts, creates engines.
 */

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOpenAPISpec } from '@api2aux/semantic-analysis'
import type { ParsedAPI } from '@api2aux/semantic-analysis'
import { ChatEngine } from '../../src/engine'
import { buildChatContext } from '../../src/context'
import { MergeStrategy } from '../../src/types'
import type {
  LLMCompletionFn,
  ToolExecutorFn,
  ChatEngineConfig,
  ChatEnginePlugin,
  ChatEngineContext,
  ChatEngineEvent,
} from '../../src/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** Local fixtures directory for chat-engine tests. */
export const CHAT_FIXTURES_DIR = resolve(__dirname, '../fixtures')

/** Workflow-inference fixtures directory (shared specs). */
export const WI_FIXTURES_DIR = resolve(__dirname, '../../../workflow-inference/src/functional/fixtures')

/** Spec name → file path mapping. */
const SPEC_PATHS: Record<string, string> = {
  'dnd5e': resolve(CHAT_FIXTURES_DIR, 'dnd5e-api.json'),
  'spotify': resolve(WI_FIXTURES_DIR, 'spotify-web-api.yaml'),
  'tvmaze': resolve(WI_FIXTURES_DIR, 'tvmaze-api.yaml'),
  'amadeus': resolve(WI_FIXTURES_DIR, 'amadeus-flight-offers-search.json'),
  'listen-notes': resolve(WI_FIXTURES_DIR, 'listen-notes-api.yaml'),
}

/** Load and parse a spec by short name. */
export async function loadSpec(name: keyof typeof SPEC_PATHS): Promise<ParsedAPI> {
  const path = SPEC_PATHS[name]
  if (!path) throw new Error(`Unknown spec: ${name}. Available: ${Object.keys(SPEC_PATHS).join(', ')}`)
  return parseOpenAPISpec(path)
}

/** Build a ChatEngineContext from a parsed spec. */
export function buildContext(spec: ParsedAPI): ChatEngineContext {
  return buildChatContext(spec.baseUrl, spec as unknown as ChatEngineContext['spec'])
}

/** Create a ChatEngine with defaults suitable for testing. */
export function buildTestEngine(
  spec: ParsedAPI,
  llm: LLMCompletionFn,
  executor: ToolExecutorFn,
  config?: Partial<ChatEngineConfig>,
  plugins?: ChatEnginePlugin[],
): ChatEngine {
  const context = buildContext(spec)
  return new ChatEngine(llm, executor, context, {
    mergeStrategy: MergeStrategy.Array,
    ...config,
  }, plugins)
}

/** Collect all events from a sendMessage call. */
export function collectEvents(): { events: ChatEngineEvent[]; handler: (e: ChatEngineEvent) => void } {
  const events: ChatEngineEvent[] = []
  return {
    events,
    handler: (e: ChatEngineEvent) => events.push(e),
  }
}
