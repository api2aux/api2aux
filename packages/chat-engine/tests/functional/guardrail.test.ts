/**
 * Functional tests: no-LLM-knowledge guardrail.
 * Verifies the engine blocks responses that don't come from API data.
 */

import { describe, it, expect } from 'vitest'
import { loadSpec, buildTestEngine, collectEvents } from '../helpers/setup'
import { createScriptedLlm } from '../helpers/mock-llm'
import { createMockExecutor, createFailingExecutor } from '../helpers/mock-executor'
import { NO_DATA_MESSAGE } from '../../src/defaults'

describe('Guardrail: no-LLM-knowledge', () => {
  it('blocks text response when no tools were called', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      { text: 'The capital of France is Paris.' },
    ])
    const executor = createMockExecutor({})
    const engine = buildTestEngine(spec, llm, executor)
    const { handler } = collectEvents()

    const result = await engine.sendMessage('What is the capital of France?', handler)

    expect(result.text).toBe(NO_DATA_MESSAGE)
    expect(result.toolResults).toHaveLength(0)
  })

  it('allows text response when tools were successfully called', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      { toolCalls: [{ name: 'get_api', args: {} }] },
      { text: 'The API has many resource types.' },
    ])
    const executor = createMockExecutor({
      'get_api': { 'ability-scores': '/api/ability-scores', 'classes': '/api/classes' },
    })
    const engine = buildTestEngine(spec, llm, executor)
    const { handler } = collectEvents()

    const result = await engine.sendMessage('What resources are available?', handler)

    expect(result.text).toBe('The API has many resource types.')
    expect(result.toolResults).toHaveLength(1)
  })

  it('activates guardrail when all tool calls fail', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      { toolCalls: [{ name: 'get_api', args: {} }] },
      { text: 'Here is some info.' },
    ])
    const executor = createFailingExecutor({
      'get_api': 'Network error',
    })
    const engine = buildTestEngine(spec, llm, executor)
    const { handler } = collectEvents()

    const result = await engine.sendMessage('What is available?', handler)

    // All tools failed → no successful results → guardrail activates
    expect(result.text).toBe(NO_DATA_MESSAGE)
  })

  it('allows text when at least one tool succeeds among failures', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createScriptedLlm([
      { toolCalls: [
        { name: 'get_api_classes_index', args: { index: 'invalid' } },
        { name: 'get_api', args: {} },
      ] },
      { text: 'Found the API resources.' },
    ])
    // First tool fails, second succeeds
    const executor = createMockExecutor((toolName) => {
      if (toolName === 'get_api_classes_index') throw new Error('Not found')
      return { classes: '/api/classes' }
    })
    const engine = buildTestEngine(spec, llm, executor)
    const { handler } = collectEvents()

    const result = await engine.sendMessage('Show me classes and resources', handler)

    // One tool succeeded → guardrail does NOT activate
    expect(result.text).toBe('Found the API resources.')
    expect(result.toolResults).toHaveLength(1)
  })
})
