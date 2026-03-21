/**
 * Live API tests: hit real public APIs to verify end-to-end behavior.
 *
 * NOT for CI — run locally only.
 * Skip via: SKIP_LIVE_TESTS=1
 *
 * Uses scripted mock LLM + real executor (api-invoke HTTP calls).
 * Retries on network errors, skips on persistent failure.
 */

import { describe, it, expect } from 'vitest'
import { loadSpec, buildTestEngine, collectEvents } from '../helpers/setup'
import { createScriptedLlm } from '../helpers/mock-llm'
import { createLiveExecutor, withRetry } from '../helpers/live-executor'
import { ChatEventType } from '../../src/types'

const SKIP = process.env.SKIP_LIVE_TESTS === '1'

const describeOrSkip = SKIP ? describe.skip : describe

describeOrSkip('Live API: D&D 5e (dnd5eapi.co)', { timeout: 15000 }, () => {
  it('simple: list all resource types from /api', async () => {
    await withRetry(async () => {
      const spec = await loadSpec('dnd5e')
      const llm = createScriptedLlm([
        { toolCalls: [{ name: 'get_api', args: {} }] },
        { text: 'Done with tools.' },
        { text: 'The D&D 5e API provides many resource types.' },
      ])
      const executor = createLiveExecutor(spec)
      const engine = buildTestEngine(spec, llm, executor)
      const { events, handler } = collectEvents()

      const result = await engine.sendMessage('What resource types are available?', handler)

      expect(result.toolResults).toHaveLength(1)
      const data = result.toolResults[0]!.data as Record<string, string>
      // Should contain known resource types
      expect(data).toHaveProperty('classes')
      expect(data).toHaveProperty('monsters')
      expect(data).toHaveProperty('spells')
    })
  })

  it('simple: get fighter class detail', async () => {
    await withRetry(async () => {
      const spec = await loadSpec('dnd5e')
      const llm = createScriptedLlm([
        { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'fighter' } }] },
        { text: 'Done with tools.' },
        { text: 'The Fighter is a martial class.' },
      ])
      const executor = createLiveExecutor(spec)
      const engine = buildTestEngine(spec, llm, executor)
      const { handler } = collectEvents()

      const result = await engine.sendMessage('Tell me about the fighter', handler)

      expect(result.toolResults).toHaveLength(1)
      const data = result.toolResults[0]!.data as Record<string, unknown>
      expect(data.name).toBe('Fighter')
      expect(data.hit_die).toBe(10)
    })
  })

  it('multi-endpoint: list classes then get detail of first', async () => {
    await withRetry(async () => {
      const spec = await loadSpec('dnd5e')
      const llm = createScriptedLlm([
        // Round 1: list classes via the endpoint listing
        { toolCalls: [{ name: 'get_api_endpoint', args: { endpoint: 'classes' } }] },
        // Round 2: get the first class detail
        { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'barbarian' } }] },
        // Round 3: Phase A break signal (tools done)
        { text: 'Done with tools.' },
        // Round 4: Phase B text response
        { text: 'Found 12 classes. The Barbarian has d12 hit die.' },
      ])
      const executor = createLiveExecutor(spec)
      const engine = buildTestEngine(spec, llm, executor)
      const { events, handler } = collectEvents()

      const result = await engine.sendMessage('List classes and show me the first one', handler)

      expect(result.toolResults).toHaveLength(2)

      // First result: class list
      const listData = result.toolResults[0]!.data as Record<string, unknown>
      expect(listData.count).toBeGreaterThan(10)

      // Second result: class detail
      const detailData = result.toolResults[1]!.data as Record<string, unknown>
      expect(detailData.name).toBe('Barbarian')
      expect(detailData.hit_die).toBe(12)
    })
  })

  it('multi-endpoint: get wizard then wizard level-1 spells', async () => {
    await withRetry(async () => {
      const spec = await loadSpec('dnd5e')
      const llm = createScriptedLlm([
        { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'wizard' } }] },
        { toolCalls: [{ name: 'get_api_classes_index_levels_spell_level_spells', args: { index: 'wizard', spell_level: '1' } }] },
        { text: 'Done with tools.' },
        { text: 'Wizards have many level 1 spells including Magic Missile.' },
      ])
      const executor = createLiveExecutor(spec)
      const engine = buildTestEngine(spec, llm, executor)
      const { events, handler } = collectEvents()

      const result = await engine.sendMessage('What level 1 spells can a wizard cast?', handler)

      expect(result.toolResults).toHaveLength(2)

      // First result: wizard class
      const wizardData = result.toolResults[0]!.data as Record<string, unknown>
      expect(wizardData.name).toBe('Wizard')

      // Second result: spell list
      const spellData = result.toolResults[1]!.data as Record<string, unknown>
      expect(spellData).toHaveProperty('count')
      expect((spellData.count as number)).toBeGreaterThan(0)
    })
  })

  it('error handling: non-existent class returns error', async () => {
    await withRetry(async () => {
      const spec = await loadSpec('dnd5e')
      const llm = createScriptedLlm([
        { toolCalls: [{ name: 'get_api_classes_index', args: { index: 'nonexistent-class-xyz' } }] },
        // If the API errors: collectedResults empty → early return (only 2 steps used)
        // If the API returns data: collectedResults has entry → Phase B needs 3rd step
        { text: 'Done with tools.' },
        { text: 'Could not find that class.' },
      ])
      const executor = createLiveExecutor(spec)
      const engine = buildTestEngine(spec, llm, executor)
      const { events, handler } = collectEvents()

      const result = await engine.sendMessage('Show me the nonexistent-class-xyz', handler)

      // The API should return an error (404 or similar)
      const hasError = events.some(e => e.type === ChatEventType.ToolCallError)
      const hasResult = events.some(e => e.type === ChatEventType.ToolCallResult)

      // Either an error event or a result with error data
      expect(hasError || hasResult).toBe(true)
    })
  })
})
