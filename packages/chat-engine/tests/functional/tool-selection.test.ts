/**
 * Functional tests: tool selection using heuristic mock LLM.
 * Verifies that the context we build from real specs gives enough signal
 * for tool selection (keyword matching as a proxy for LLM reasoning).
 */

import { describe, it, expect } from 'vitest'
import { loadSpec, buildTestEngine, collectEvents } from '../helpers/setup'
import { createHeuristicLlm } from '../helpers/mock-llm'
import { createMockExecutor } from '../helpers/mock-executor'
import { ChatEventType } from '../../src/types'

describe('Tool selection: D&D 5e API', () => {
  it('selects endpoint listing tool for "what resource types are available"', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createHeuristicLlm()
    const executor = createMockExecutor({ '*': { count: 5, results: [] } } as never)
    // Accept any tool call
    const mockExec = createMockExecutor(() => ({ count: 5, results: [] }))
    const engine = buildTestEngine(spec, llm, mockExec)
    const { events, handler } = collectEvents()

    await engine.sendMessage('What resource types are available in this API?', handler)

    const toolStart = events.find(e => e.type === ChatEventType.ToolCallStart)
    expect(toolStart).toBeDefined()
    if (toolStart?.type === ChatEventType.ToolCallStart) {
      // Should pick a tool related to the API root or endpoints
      expect(toolStart.toolName).toBeDefined()
    }
  })

  it('selects class-related tool for "tell me about classes"', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createHeuristicLlm()
    const mockExec = createMockExecutor(() => ({ index: 'fighter', name: 'Fighter' }))
    const engine = buildTestEngine(spec, llm, mockExec)
    const { events, handler } = collectEvents()

    await engine.sendMessage('Tell me about the fighter class', handler)

    const toolStart = events.find(e => e.type === ChatEventType.ToolCallStart)
    expect(toolStart).toBeDefined()
    if (toolStart?.type === ChatEventType.ToolCallStart) {
      expect(toolStart.toolName).toMatch(/class/i)
    }
  })

  it('selects monster-related tool for "show me monsters"', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createHeuristicLlm()
    const mockExec = createMockExecutor(() => ({ count: 10, results: [] }))
    const engine = buildTestEngine(spec, llm, mockExec)
    const { events, handler } = collectEvents()

    await engine.sendMessage('Show me a list of monsters', handler)

    const toolStart = events.find(e => e.type === ChatEventType.ToolCallStart)
    expect(toolStart).toBeDefined()
    if (toolStart?.type === ChatEventType.ToolCallStart) {
      expect(toolStart.toolName).toMatch(/monster/i)
    }
  })

  it('selects spell-related tool for "find spells"', async () => {
    const spec = await loadSpec('dnd5e')
    const llm = createHeuristicLlm()
    const mockExec = createMockExecutor(() => ({ count: 5, results: [] }))
    const engine = buildTestEngine(spec, llm, mockExec)
    const { events, handler } = collectEvents()

    await engine.sendMessage('Find all available spells', handler)

    const toolStart = events.find(e => e.type === ChatEventType.ToolCallStart)
    expect(toolStart).toBeDefined()
    if (toolStart?.type === ChatEventType.ToolCallStart) {
      expect(toolStart.toolName).toMatch(/spell/i)
    }
  })
})

describe('Tool selection: TVMaze API', () => {
  it('selects a show-related tool for "find shows about dragons"', async () => {
    const spec = await loadSpec('tvmaze')
    const llm = createHeuristicLlm()
    const mockExec = createMockExecutor(() => [{ id: 1, name: 'Dragons' }])
    const engine = buildTestEngine(spec, llm, mockExec)
    const { events, handler } = collectEvents()

    await engine.sendMessage('Find TV shows about dragons', handler)

    const toolStart = events.find(e => e.type === ChatEventType.ToolCallStart)
    expect(toolStart).toBeDefined()
    // The heuristic should pick a tool related to shows (search or show-related)
    if (toolStart?.type === ChatEventType.ToolCallStart) {
      expect(toolStart.toolName).toMatch(/show|search|find/i)
    }
  })
})

describe('Tool selection: Spotify Web API', () => {
  it('selects a track-related tool for "search for Radiohead tracks"', async () => {
    const spec = await loadSpec('spotify')
    const llm = createHeuristicLlm()
    const mockExec = createMockExecutor(() => ({ tracks: { items: [] } }))
    const engine = buildTestEngine(spec, llm, mockExec)
    const { events, handler } = collectEvents()

    await engine.sendMessage('Search for Radiohead tracks', handler)

    const toolStart = events.find(e => e.type === ChatEventType.ToolCallStart)
    expect(toolStart).toBeDefined()
    // The heuristic should pick a tool related to search or tracks
    if (toolStart?.type === ChatEventType.ToolCallStart) {
      expect(toolStart.toolName).toMatch(/search|track/i)
    }
  })
})
