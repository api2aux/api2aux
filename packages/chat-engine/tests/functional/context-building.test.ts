/**
 * Functional tests: context building from real API specs.
 * Verifies that buildChatContext produces sensible tools and system prompts.
 * No LLM or executor needed — pure spec → context assertions.
 */

import { describe, it, expect } from 'vitest'
import { loadSpec, buildContext } from '../helpers/setup'

describe('Context building: D&D 5e API', () => {
  it('generates tools matching operation count', async () => {
    const spec = await loadSpec('dnd5e')
    const ctx = buildContext(spec)

    expect(ctx.tools.length).toBe(spec.operations.length)
    expect(ctx.tools.length).toBeGreaterThan(40)
  })

  it('includes key tool names', async () => {
    const spec = await loadSpec('dnd5e')
    const ctx = buildContext(spec)
    const names = ctx.tools.map(t => t.function.name)

    expect(names).toContain('get_api')
    // D&D uses operationId-based names
    const hasClassTool = names.some(n => n.includes('class'))
    expect(hasClassTool).toBe(true)
    const hasMonsterTool = names.some(n => n.includes('monster'))
    expect(hasMonsterTool).toBe(true)
  })

  it('system prompt contains API title', async () => {
    const spec = await loadSpec('dnd5e')
    const ctx = buildContext(spec)

    expect(ctx.systemPrompt).toContain('D&D 5e')
  })

  it('system prompt enforces no-knowledge rule', async () => {
    const spec = await loadSpec('dnd5e')
    const ctx = buildContext(spec)

    expect(ctx.systemPrompt).toContain('NEVER answer from your own knowledge')
  })

  it('system prompt includes tool catalog for large API', async () => {
    const spec = await loadSpec('dnd5e')
    const ctx = buildContext(spec)

    // D&D has 47 ops > 10, so tool catalog should be generated
    expect(ctx.systemPrompt).toContain('Tool categories')
  })
})

describe('Context building: Spotify Web API', () => {
  it('generates tools for all operations', async () => {
    const spec = await loadSpec('spotify')
    const ctx = buildContext(spec)

    expect(ctx.tools.length).toBe(spec.operations.length)
    expect(ctx.tools.length).toBeGreaterThan(50)
  })

  it('system prompt detects search capabilities', async () => {
    const spec = await loadSpec('spotify')
    const ctx = buildContext(spec)

    expect(ctx.systemPrompt).toContain('Search capabilities')
  })

  it('system prompt detects pagination hints', async () => {
    const spec = await loadSpec('spotify')
    const ctx = buildContext(spec)

    expect(ctx.systemPrompt).toContain('Pagination')
  })

  it('system prompt includes tool catalog', async () => {
    const spec = await loadSpec('spotify')
    const ctx = buildContext(spec)

    expect(ctx.systemPrompt).toContain('Tool categories')
  })
})

describe('Context building: TVMaze API', () => {
  it('generates tools for operations', async () => {
    const spec = await loadSpec('tvmaze')
    const ctx = buildContext(spec)

    expect(ctx.tools.length).toBeGreaterThan(5)
  })

  it('includes show-related tools', async () => {
    const spec = await loadSpec('tvmaze')
    const ctx = buildContext(spec)
    const names = ctx.tools.map(t => t.function.name)

    const hasShowTool = names.some(n => n.includes('show'))
    expect(hasShowTool).toBe(true)
  })
})

describe('Context building: Amadeus Flight Offers', () => {
  it('generates tools without errors', async () => {
    const spec = await loadSpec('amadeus')
    const ctx = buildContext(spec)

    expect(ctx.tools.length).toBeGreaterThan(0)
  })

  it('preserves required parameters', async () => {
    const spec = await loadSpec('amadeus')
    const ctx = buildContext(spec)

    const hasRequired = ctx.tools.some(t =>
      t.function.parameters.required && t.function.parameters.required.length > 0
    )
    expect(hasRequired).toBe(true)
  })
})

describe('Context building: Listen Notes Podcast API', () => {
  it('generates tools with search capabilities', async () => {
    const spec = await loadSpec('listen-notes')
    const ctx = buildContext(spec)

    expect(ctx.tools.length).toBeGreaterThan(3)

    const names = ctx.tools.map(t => t.function.name)
    const hasSearch = names.some(n => n.includes('search'))
    expect(hasSearch).toBe(true)
  })
})
