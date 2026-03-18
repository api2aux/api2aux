/**
 * Functional tests: error handling and recovery.
 * Verifies the engine gracefully handles tool call failures.
 */

import { describe, it, expect } from 'vitest'
import { loadSpec, buildTestEngine, collectEvents } from '../helpers/setup'
import { createScriptedLlm } from '../helpers/mock-llm'
import { createMockExecutor, createFailingExecutor } from '../helpers/mock-executor'
import { ChatEventType } from '../../src/types'
import { NO_DATA_MESSAGE } from '../../src/defaults'

describe('Error recovery: D&D 5e API', () => {
  it('recovers when first tool fails and LLM retries with different tool', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      // Round 1: LLM tries a detail endpoint without required param
      { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'nonexistent' } }] },
      // Round 2: LLM falls back to the list endpoint
      { toolCalls: [{ name: 'get_api', args: {} }] },
      // Round 3: LLM produces text
      { text: 'Found the API resources after retrying.' },
    ])
    const executor = createMockExecutor((toolName, args) => {
      if (toolName === 'get_api_classes_index') throw new Error('Not found: nonexistent')
      return { classes: '/api/classes', monsters: '/api/monsters' }
    })
    const engine = buildTestEngine(spec, llm, executor)
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('What classes are available?', handler)

    // Should have error for first call
    const errorEvents = events.filter(e => e.type === ChatEventType.ToolCallError)
    expect(errorEvents).toHaveLength(1)

    // Should have success for second call
    const resultEvents = events.filter(e => e.type === ChatEventType.ToolCallResult)
    expect(resultEvents).toHaveLength(1)

    // Final text should come through (tool succeeded)
    expect(result.text).toBe('Found the API resources after retrying.')
  })

  it('emits error event for malformed tool arguments', async () => {
    const spec = await loadSpec('dnd5e')

    let callCount = 0
    const llm = createScriptedLlm([
      // Simulated by creating a scripted response — but we need malformed JSON
      // So we'll use a custom LLM mock for this specific test
    ])

    // Custom LLM that returns malformed JSON on first call
    const customLlm = async (
      _messages: unknown[],
      tools: unknown[],
      onToken: (t: string) => void,
    ) => {
      callCount++
      if (callCount === 1) {
        return {
          content: '',
          tool_calls: [{
            id: 'call_bad',
            type: 'function' as const,
            function: { name: 'get_api', arguments: '{invalid json!' },
          }],
          finish_reason: 'tool_calls',
        }
      }
      onToken('Recovered from error.')
      return { content: 'Recovered from error.', tool_calls: [], finish_reason: 'stop' }
    }

    const executor = createMockExecutor({})
    const engine = buildTestEngine(spec, customLlm as never, executor)
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('Get API info', handler)

    const errorEvent = events.find(e => e.type === ChatEventType.ToolCallError)
    expect(errorEvent).toBeDefined()
    if (errorEvent?.type === ChatEventType.ToolCallError) {
      expect(errorEvent.error).toContain('Invalid JSON')
    }
  })

  it('handles executor throwing HTTP-like errors', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'wizard' } }] },
      { text: 'Auth error encountered.' },
    ])
    const executor = createFailingExecutor({
      'get_api_classes_index': 'HTTP 401: Unauthorized - Invalid API key',
    })
    const engine = buildTestEngine(spec, llm, executor)
    const { events, handler } = collectEvents()

    const result = await engine.sendMessage('Show me the wizard class', handler)

    const errorEvent = events.find(e => e.type === ChatEventType.ToolCallError)
    expect(errorEvent).toBeDefined()
    if (errorEvent?.type === ChatEventType.ToolCallError) {
      expect(errorEvent.error).toContain('401')
    }

    // Guardrail activates since no successful results
    expect(result.text).toBe(NO_DATA_MESSAGE)
  })
})
