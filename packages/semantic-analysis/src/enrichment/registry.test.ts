/**
 * Unit tests for EnrichmentPluginRegistry.
 * Each test creates a fresh instance to avoid shared state.
 */

import { describe, it, expect } from 'vitest'
import { EnrichmentPluginRegistry } from './registry'
import type { EnrichmentPlugin, OperationContext, ToolEnrichmentHint, DomainSignature } from '../types/enrichment'
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

// ============================================================================
// getToolHints with hierarchy
// ============================================================================
describe('EnrichmentPluginRegistry.getToolHints hierarchy', () => {
  it('child overrides parent parameterHints for same operation', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({
      id: '@domain/base',
      enrichTools: () => {
        const m = new Map<string, ToolEnrichmentHint>()
        m.set('list_users', { descriptionSuffix: 'Base.', parameterHints: { q: 'Search (base)' } })
        return m
      },
    }))
    reg.register(mockPlugin({
      id: '@domain/child',
      extends: '@domain/base',
      enrichTools: () => {
        const m = new Map<string, ToolEnrichmentHint>()
        m.set('list_users', { descriptionSuffix: 'Child.', parameterHints: { q: 'Search (child)' } })
        return m
      },
    }))
    const result = reg.getToolHints([mockOp()])
    const hint = result.get('list_users')!
    expect(hint.descriptionSuffix).toBe('Base. Child.')
    expect(hint.parameterHints!.q).toBe('Search (child)')
  })
})

// ============================================================================
// Hierarchy resolution order
// ============================================================================
describe('EnrichmentPluginRegistry hierarchy resolution', () => {
  it('orders parent before child', () => {
    const reg = freshRegistry()
    // Register child first, parent second — resolution should still put parent first
    reg.register(mockPlugin({ id: '@domain/child', extends: '@domain/base' }))
    reg.register(mockPlugin({ id: '@domain/base' }))
    const order = reg.getEffectivePlugins()
    expect(order.map(p => p.id)).toEqual(['@domain/base', '@domain/child'])
  })

  it('orders three-level chain correctly', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@domain/grandchild', extends: '@domain/child' }))
    reg.register(mockPlugin({ id: '@domain/base' }))
    reg.register(mockPlugin({ id: '@domain/child', extends: '@domain/base' }))
    const order = reg.getEffectivePlugins()
    expect(order.map(p => p.id)).toEqual(['@domain/base', '@domain/child', '@domain/grandchild'])
  })

  it('sorts by priority within the same tier', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@a', priority: 10 }))
    reg.register(mockPlugin({ id: '@b', priority: 5 }))
    reg.register(mockPlugin({ id: '@c', priority: 0 }))
    const order = reg.getEffectivePlugins()
    expect(order.map(p => p.id)).toEqual(['@c', '@b', '@a'])
  })

  it('handles multiple independent roots', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@health/base' }))
    reg.register(mockPlugin({ id: '@finance/base' }))
    reg.register(mockPlugin({ id: '@health/acme', extends: '@health/base' }))
    const order = reg.getEffectivePlugins()
    // Both roots at depth 0, then child at depth 1
    const rootIds = order.slice(0, 2).map(p => p.id)
    expect(rootIds).toContain('@health/base')
    expect(rootIds).toContain('@finance/base')
    expect(order[2].id).toBe('@health/acme')
  })

  it('throws on circular extends (A → B → A)', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@a', extends: '@b' }))
    reg.register(mockPlugin({ id: '@b', extends: '@a' }))
    expect(() => reg.getEffectivePlugins()).toThrow(/circular/i)
  })

  it('throws on self-referencing extends', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@a', extends: '@a' }))
    expect(() => reg.getEffectivePlugins()).toThrow(/circular/i)
  })

  it('throws on missing parent', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@child', extends: '@nonexistent' }))
    expect(() => reg.getEffectivePlugins()).toThrow(/unknown plugin/i)
  })

  it('returns empty array for empty registry', () => {
    const reg = freshRegistry()
    expect(reg.getEffectivePlugins()).toEqual([])
  })

  it('circular error includes full cycle path', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@a', extends: '@b' }))
    reg.register(mockPlugin({ id: '@b', extends: '@c' }))
    reg.register(mockPlugin({ id: '@c', extends: '@a' }))
    expect(() => reg.getEffectivePlugins()).toThrow(/→/)
  })

  it('invalidates cache on register', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@a' }))
    const first = reg.getEffectivePlugins()
    expect(first).toHaveLength(1)
    reg.register(mockPlugin({ id: '@b' }))
    const second = reg.getEffectivePlugins()
    expect(second).toHaveLength(2)
  })

  it('invalidates cache on unregister', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@a' }))
    reg.register(mockPlugin({ id: '@b' }))
    expect(reg.getEffectivePlugins()).toHaveLength(2)
    reg.unregister('@b')
    expect(reg.getEffectivePlugins()).toHaveLength(1)
  })
})

// ============================================================================
// Override semantics: tagOperations — child replaces parent tag with same ID
// ============================================================================
describe('EnrichmentPluginRegistry tagOperations override semantics', () => {
  it('child replaces parent tag with the same tag ID', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({
      id: '@domain/base',
      tagOperations: () => [[{ id: 'crud:list', label: 'List', confidence: 0.7 }]],
    }))
    reg.register(mockPlugin({
      id: '@domain/child',
      extends: '@domain/base',
      tagOperations: () => [[{ id: 'crud:list', label: 'List Items', confidence: 0.95 }]],
    }))
    const ops = [mockOp()]
    const result = reg.tagOperations(ops)
    const tags = result.get('list_users')!
    expect(tags).toHaveLength(1)
    expect(tags[0].confidence).toBe(0.95)
    expect(tags[0].label).toBe('List Items')
  })

  it('child adds new tag IDs alongside parent tags', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({
      id: '@domain/base',
      tagOperations: () => [[{ id: 'crud:list', label: 'List', confidence: 0.8 }]],
    }))
    reg.register(mockPlugin({
      id: '@domain/child',
      extends: '@domain/base',
      tagOperations: () => [[{ id: 'auth:public', label: 'Public', confidence: 0.9 }]],
    }))
    const ops = [mockOp()]
    const result = reg.tagOperations(ops)
    const tags = result.get('list_users')!
    expect(tags).toHaveLength(2)
    expect(tags.map(t => t.id).sort()).toEqual(['auth:public', 'crud:list'])
  })
})

// ============================================================================
// getDomainSignatures
// ============================================================================
describe('EnrichmentPluginRegistry.getDomainSignatures', () => {
  it('collects only plugins with domain signatures', () => {
    const reg = freshRegistry()
    const sig: DomainSignature = { keywords: ['patient', 'diagnosis'] }
    reg.register(mockPlugin({ id: '@health/base', domainSignature: sig }))
    reg.register(mockPlugin({ id: '@other/base' }))
    const sigs = reg.getDomainSignatures()
    expect(sigs.size).toBe(1)
    expect(sigs.get('@health/base')).toBe(sig)
  })

  it('returns empty map when no plugins have signatures', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    expect(reg.getDomainSignatures().size).toBe(0)
  })
})

// ============================================================================
// getDomainImportantFieldNames
// ============================================================================
describe('EnrichmentPluginRegistry.getDomainImportantFieldNames', () => {
  it('extracts literal field names from namePatterns and nameKeywords', () => {
    const reg = freshRegistry()
    const cat: PluginSemanticCategory = {
      id: '@test/sku',
      name: 'SKU',
      description: 'Product SKU',
      namePatterns: [/^sku$/i, /^product_code$/],
      nameKeywords: ['item_number'],
      validate: () => true,
    }
    reg.register(mockPlugin({ id: '@test/a', fieldCategories: [cat] }))
    const names = reg.getDomainImportantFieldNames()
    expect(names.has('sku')).toBe(true)
    expect(names.has('product_code')).toBe(true)
    expect(names.has('item_number')).toBe(true)
  })

  it('skips non-literal regex patterns', () => {
    const reg = freshRegistry()
    const cat: PluginSemanticCategory = {
      id: '@test/complex',
      name: 'Complex',
      description: 'Complex pattern',
      namePatterns: [/sku|product/i, /price\d+/],
      validate: () => true,
    }
    reg.register(mockPlugin({ id: '@test/a', fieldCategories: [cat] }))
    const names = reg.getDomainImportantFieldNames()
    // These patterns contain regex metacharacters, so they should be skipped
    expect(names.size).toBe(0)
  })

  it('returns empty set when no plugins have field categories', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({ id: '@test/a' }))
    expect(reg.getDomainImportantFieldNames().size).toBe(0)
  })
})

// ============================================================================
// DomainSignature validation at registration
// ============================================================================
describe('EnrichmentPluginRegistry domainSignature validation', () => {
  it('throws on empty keywords array', () => {
    const reg = freshRegistry()
    expect(() => reg.register(mockPlugin({
      id: '@test/a',
      domainSignature: { keywords: [] },
    }))).toThrow(/keywords must not be empty/i)
  })

  it('throws on threshold out of range (> 1)', () => {
    const reg = freshRegistry()
    expect(() => reg.register(mockPlugin({
      id: '@test/a',
      domainSignature: { keywords: ['patient'], threshold: 1.5 },
    }))).toThrow(/threshold must be between 0 and 1/i)
  })

  it('throws on threshold out of range (< 0)', () => {
    const reg = freshRegistry()
    expect(() => reg.register(mockPlugin({
      id: '@test/a',
      domainSignature: { keywords: ['patient'], threshold: -0.1 },
    }))).toThrow(/threshold must be between 0 and 1/i)
  })

  it('accepts valid domainSignature', () => {
    const reg = freshRegistry()
    reg.register(mockPlugin({
      id: '@test/a',
      domainSignature: { keywords: ['patient'], threshold: 0.5 },
    }))
    expect(reg.size).toBe(1)
  })
})
