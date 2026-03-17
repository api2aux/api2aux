/**
 * Unit tests for EnrichmentPluginRegistry.
 * Each test creates a fresh instance to avoid shared state.
 */

import { describe, it, expect } from 'vitest'
import { EnrichmentPluginRegistry } from './registry'
import type { EnrichmentPlugin, OperationContext, ToolEnrichmentHint } from '../types/enrichment'
import type { PluginSemanticCategory } from '../types/plugins'

/** Create a minimal enrichment plugin for testing. */
function mockPlugin(overrides: Partial<EnrichmentPlugin> & { id: string }): EnrichmentPlugin {
  return {
    name: overrides.id,
    version: '1.0.0',
    ...overrides,
  }
}

/** Create a minimal operation context for testing. */
function mockOp(overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    id: 'list_users',
    path: '/users',
    method: 'GET',
    tags: ['users'],
    parameters: [],
    responseFieldNames: ['id', 'name', 'email'],
    ...overrides,
  }
}

function freshRegistry() {
  return new EnrichmentPluginRegistry()
}

// ============================================================================
// register / unregister / get / size / clear
// ============================================================================
describe('EnrichmentPluginRegistry basics', () => {
  it('registers and retrieves a plugin by ID', () => {
    const reg = freshRegistry()
    const plugin = mockPlugin({ id: '@test/a' })
    reg.register(plugin)
    expect(reg.get('@test/a')).toBe(plugin)
    expect(reg.size).toBe(1)
  })

  it('replaces existing plugin with same ID', () => {
    const reg = freshRegistry()
    const p1 = mockPlugin({ id: '@test/a', name: 'First' })
    const p2 = mockPlugin({ id: '@test/a', name: 'Second' })
    reg.register(p1)
    reg.register(p2)
    expect(reg.size).toBe(1)
    expect(reg.get('@test/a')!.name).toBe('Second')
  })

  it('unregisters a plugin', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    expect(reg.unregister('@test/a')).toBe(true)
    expect(reg.size).toBe(0)
    expect(reg.get('@test/a')).toBeUndefined()
  })

  it('returns false when unregistering unknown plugin', () => {
    const reg = freshRegistry()
    expect(reg.unregister('@test/nonexistent')).toBe(false)
  })

  it('getAll returns all registered plugins', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    reg.register(mockPlugin({ id: '@test/b' }))
    expect(reg.getAll()).toHaveLength(2)
  })

  it('clear removes all plugins', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    reg.register(mockPlugin({ id: '@test/b' }))
    reg.clear()
    expect(reg.size).toBe(0)
  })
})

// ============================================================================
// getAllFieldCategories
// ============================================================================
describe('EnrichmentPluginRegistry.getAllFieldCategories', () => {
  it('returns empty array when no plugins have field categories', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    expect(reg.getAllFieldCategories()).toEqual([])
  })

  it('aggregates field categories from multiple plugins', () => {
    const reg = freshRegistry()
    const cat1: PluginSemanticCategory = {
      id: '@test/sku',
      name: 'SKU',
      description: 'Product SKU',
      namePatterns: [/sku/i],
      validate: () => true,
    }
    const cat2: PluginSemanticCategory = {
      id: '@test/asin',
      name: 'ASIN',
      description: 'Amazon ASIN',
      namePatterns: [/asin/i],
      validate: () => true,
    }
    reg.register(mockPlugin({ id: '@test/a', fieldCategories: [cat1] }))
    reg.register(mockPlugin({ id: '@test/b', fieldCategories: [cat2] }))
    const result = reg.getAllFieldCategories()
    expect(result).toHaveLength(2)
    expect(result.map(c => c.id)).toEqual(['@test/sku', '@test/asin'])
  })
})

// ============================================================================
// tagOperations
// ============================================================================
describe('EnrichmentPluginRegistry.tagOperations', () => {
  it('returns empty tags when no plugins have taggers', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    const ops = [mockOp()]
    const result = reg.tagOperations(ops)
    expect(result.get('list_users')).toEqual([])
  })

  it('aggregates tags from multiple plugins', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({
      id: '@test/a',
      tagOperations: (ops) => ops.map(() => [{ id: 'auth:public', label: 'Public', confidence: 0.9 }]),
    }))
    reg.register(mockPlugin({
      id: '@test/b',
      tagOperations: (ops) => ops.map(() => [{ id: 'crud:list', label: 'List', confidence: 0.8 }]),
    }))
    const ops = [mockOp()]
    const result = reg.tagOperations(ops)
    const tags = result.get('list_users')!
    expect(tags).toHaveLength(2)
    expect(tags.map(t => t.id)).toEqual(['auth:public', 'crud:list'])
  })
})

// ============================================================================
// getToolHints
// ============================================================================
describe('EnrichmentPluginRegistry.getToolHints', () => {
  it('returns empty map when no plugins have tool enrichers', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    const result = reg.getToolHints([mockOp()])
    expect(result.size).toBe(0)
  })

  it('collects hints from a single plugin', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({
      id: '@test/a',
      enrichTools: (ops) => {
        const m = new Map<string, ToolEnrichmentHint>()
        m.set(ops[0].id, { descriptionSuffix: 'Returns users.', priority: 0.5 })
        return m
      },
    }))
    const result = reg.getToolHints([mockOp()])
    expect(result.get('list_users')!.descriptionSuffix).toBe('Returns users.')
    expect(result.get('list_users')!.priority).toBe(0.5)
  })

  it('merges hints from multiple plugins (concatenates descriptions, max priority)', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({
      id: '@test/a',
      enrichTools: () => {
        const m = new Map<string, ToolEnrichmentHint>()
        m.set('list_users', {
          descriptionSuffix: 'First hint.',
          parameterHints: { page: 'Page number' },
          priority: 0.5,
        })
        return m
      },
    }))
    reg.register(mockPlugin({
      id: '@test/b',
      enrichTools: () => {
        const m = new Map<string, ToolEnrichmentHint>()
        m.set('list_users', {
          descriptionSuffix: 'Second hint.',
          parameterHints: { limit: 'Max results' },
          priority: 0.8,
        })
        return m
      },
    }))
    const result = reg.getToolHints([mockOp()])
    const hint = result.get('list_users')!
    expect(hint.descriptionSuffix).toBe('First hint. Second hint.')
    expect(hint.parameterHints).toEqual({ page: 'Page number', limit: 'Max results' })
    expect(hint.priority).toBe(0.8)
  })

  it('later plugin overwrites conflicting parameter hints', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({
      id: '@test/a',
      enrichTools: () => {
        const m = new Map<string, ToolEnrichmentHint>()
        m.set('list_users', { parameterHints: { q: 'Search query (v1)' } })
        return m
      },
    }))
    reg.register(mockPlugin({
      id: '@test/b',
      enrichTools: () => {
        const m = new Map<string, ToolEnrichmentHint>()
        m.set('list_users', { parameterHints: { q: 'Search query (v2)' } })
        return m
      },
    }))
    const result = reg.getToolHints([mockOp()])
    expect(result.get('list_users')!.parameterHints!.q).toBe('Search query (v2)')
  })
})

// ============================================================================
// getUIHints
// ============================================================================
describe('EnrichmentPluginRegistry.getUIHints', () => {
  it('returns empty array when no plugins have UI hints', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    expect(reg.getUIHints([mockOp()])).toEqual([])
  })

  it('collects UI hints from multiple plugins', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({
      id: '@test/a',
      uiHints: () => [{ fieldPattern: '*.email', suggestedComponent: 'core/email-link', confidence: 0.9 }],
    }))
    reg.register(mockPlugin({
      id: '@test/b',
      uiHints: () => [{ fieldPattern: '*.avatar', suggestedComponent: 'core/image', confidence: 0.85 }],
    }))
    const result = reg.getUIHints([mockOp()])
    expect(result).toHaveLength(2)
    expect(result[0].fieldPattern).toBe('*.email')
    expect(result[1].fieldPattern).toBe('*.avatar')
  })
})

// ============================================================================
// getWorkflowPatterns
// ============================================================================
describe('EnrichmentPluginRegistry.getWorkflowPatterns', () => {
  it('returns empty array when no plugins have workflow patterns', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    expect(reg.getWorkflowPatterns()).toEqual([])
  })

  it('collects workflow patterns from multiple plugins', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({
      id: '@test/a',
      workflowPatterns: () => [{
        name: 'checkout-flow',
        steps: [{ operationPattern: /list.*products/i, role: 'browse' }],
        edgeWeightBoost: 0.3,
      }],
    }))
    reg.register(mockPlugin({
      id: '@test/b',
      workflowPatterns: () => [{
        name: 'kyc-flow',
        steps: [{ operationPattern: /verify.*identity/i, role: 'verify' }],
        edgeWeightBoost: 0.2,
      }],
    }))
    const result = reg.getWorkflowPatterns()
    expect(result).toHaveLength(2)
    expect(result.map(p => p.name)).toEqual(['checkout-flow', 'kyc-flow'])
  })
})

// ============================================================================
// getDisambiguators
// ============================================================================
describe('EnrichmentPluginRegistry.getDisambiguators', () => {
  it('returns empty array when no plugins have disambiguators', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    expect(reg.getDisambiguators()).toEqual([])
  })

  it('returns only plugins with disambiguate hook', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    reg.register(mockPlugin({
      id: '@test/b',
      disambiguate: async (matches) => matches.map(m => ({
        sourceOperationId: m.sourceOperationId,
        targetOperationId: m.targetOperationId,
        refinedScore: 0.8,
        confirmed: true,
      })),
    }))
    const disambiguators = reg.getDisambiguators()
    expect(disambiguators).toHaveLength(1)
    expect(disambiguators[0].id).toBe('@test/b')
  })
})
