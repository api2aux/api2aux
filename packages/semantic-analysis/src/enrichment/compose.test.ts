/**
 * Unit tests for composeEnrichmentPlugin.
 */

import { describe, it, expect } from 'vitest'
import { composeEnrichmentPlugin } from './compose'
import type { EnrichmentPlugin, OperationContext, ToolEnrichmentHint } from '../types/enrichment'
import type { PluginSemanticCategory } from '../types/plugins'

function mockPlugin(overrides: Partial<EnrichmentPlugin> & { id: string }): EnrichmentPlugin {
  return {
    name: overrides.id,
    version: '1.0.0',
    ...overrides,
  }
}

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

function mockCategory(id: string): PluginSemanticCategory {
  return {
    id,
    name: id,
    description: id,
    namePatterns: [new RegExp(`^${id}$`, 'i')],
    validate: () => true,
  }
}

describe('composeEnrichmentPlugin', () => {
  it('auto-sets extends to base.id', () => {
    const base = mockPlugin({ id: '@domain/base' })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
    })
    expect(composed.extends).toBe('@domain/base')
  })

  it('auto-increments priority from base', () => {
    const base = mockPlugin({ id: '@domain/base', priority: 5 })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
    })
    expect(composed.priority).toBe(6)
  })

  it('uses override priority when provided', () => {
    const base = mockPlugin({ id: '@domain/base', priority: 5 })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      priority: 20,
    })
    expect(composed.priority).toBe(20)
  })

  it('concatenates fieldCategories (additive)', () => {
    const catA = mockCategory('@domain/sku')
    const catB = mockCategory('@domain/asin')
    const base = mockPlugin({ id: '@domain/base', fieldCategories: [catA] })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      fieldCategories: [catB],
    })
    expect(composed.fieldCategories).toHaveLength(2)
    expect(composed.fieldCategories!.map(c => c.id)).toEqual(['@domain/sku', '@domain/asin'])
  })

  it('tagOperations: child overrides parent tag with same ID', () => {
    const base = mockPlugin({
      id: '@domain/base',
      tagOperations: () => [[{ id: 'crud:list', label: 'List', confidence: 0.7 }]],
    })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      tagOperations: () => [[{ id: 'crud:list', label: 'List Items', confidence: 0.95 }]],
    })
    const result = composed.tagOperations!([mockOp()])
    expect(result[0]).toHaveLength(1)
    expect(result[0][0].confidence).toBe(0.95)
    expect(result[0][0].label).toBe('List Items')
  })

  it('tagOperations: child adds new tags alongside parent', () => {
    const base = mockPlugin({
      id: '@domain/base',
      tagOperations: () => [[{ id: 'crud:list', label: 'List', confidence: 0.8 }]],
    })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      tagOperations: () => [[{ id: 'auth:public', label: 'Public', confidence: 0.9 }]],
    })
    const result = composed.tagOperations!([mockOp()])
    expect(result[0]).toHaveLength(2)
    expect(result[0].map(t => t.id).sort()).toEqual(['auth:public', 'crud:list'])
  })

  it('enrichTools: child merges on top of base', () => {
    const base = mockPlugin({
      id: '@domain/base',
      enrichTools: () => {
        const m = new Map<string, ToolEnrichmentHint>()
        m.set('list_users', { descriptionSuffix: 'Base hint.', parameterHints: { q: 'Search (base)' } })
        return m
      },
    })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      enrichTools: () => {
        const m = new Map<string, ToolEnrichmentHint>()
        m.set('list_users', { descriptionSuffix: 'Child hint.', parameterHints: { q: 'Search (child)' } })
        return m
      },
    })
    const result = composed.enrichTools!([mockOp()])
    const hint = result.get('list_users')!
    expect(hint.descriptionSuffix).toBe('Base hint. Child hint.')
    expect(hint.parameterHints!.q).toBe('Search (child)')
  })

  it('disambiguate: chains base then overrides', async () => {
    const base = mockPlugin({
      id: '@domain/base',
      disambiguate: async (matches) => matches.map(m => ({
        sourceOperationId: m.sourceOperationId,
        targetOperationId: m.targetOperationId,
        refinedScore: 0.5,
        confirmed: false,
        reasoning: 'base says maybe',
      })),
    })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      disambiguate: async (matches) => matches.map(m => ({
        sourceOperationId: m.sourceOperationId,
        targetOperationId: m.targetOperationId,
        refinedScore: 0.9,
        confirmed: true,
        reasoning: 'child confirms',
      })),
    })
    const result = await composed.disambiguate!([{
      sourceOperationId: 'op_a',
      targetOperationId: 'op_b',
      sourceField: 'id',
      targetParam: 'userId',
      currentScore: 0.3,
      context: 'test',
    }])
    expect(result[0].confirmed).toBe(true)
    expect(result[0].refinedScore).toBe(0.9)
  })

  it('uses only base hooks when overrides has none', () => {
    const base = mockPlugin({
      id: '@domain/base',
      tagOperations: () => [[{ id: 'crud:list', label: 'List', confidence: 0.8 }]],
    })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
    })
    const result = composed.tagOperations!([mockOp()])
    expect(result[0]).toHaveLength(1)
    expect(result[0][0].id).toBe('crud:list')
  })

  it('uses only override hooks when base has none', () => {
    const base = mockPlugin({ id: '@domain/base' })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      tagOperations: () => [[{ id: 'crud:list', label: 'List', confidence: 0.8 }]],
    })
    const result = composed.tagOperations!([mockOp()])
    expect(result[0]).toHaveLength(1)
    expect(result[0][0].id).toBe('crud:list')
  })

  it('inherits domainSignature from base when overrides lacks one', () => {
    const sig = { keywords: ['patient', 'diagnosis'] }
    const base = mockPlugin({ id: '@domain/base', domainSignature: sig })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
    })
    expect(composed.domainSignature).toBe(sig)
  })

  it('override domainSignature takes precedence', () => {
    const baseSig = { keywords: ['patient'] }
    const childSig = { keywords: ['claim', 'policy'] }
    const base = mockPlugin({ id: '@domain/base', domainSignature: baseSig })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      domainSignature: childSig,
    })
    expect(composed.domainSignature).toBe(childSig)
  })

  it('uiHints: additive composition concatenates base and overrides', () => {
    const base = mockPlugin({
      id: '@domain/base',
      uiHints: () => [{ fieldPattern: '*.email', suggestedComponent: 'core/email-link', confidence: 0.9 }],
    })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      uiHints: () => [{ fieldPattern: '*.avatar', suggestedComponent: 'core/image', confidence: 0.85 }],
    })
    const result = composed.uiHints!([mockOp()])
    expect(result).toHaveLength(2)
    expect(result[0].fieldPattern).toBe('*.email')
    expect(result[1].fieldPattern).toBe('*.avatar')
  })

  it('workflowPatterns: additive composition concatenates base and overrides', () => {
    const base = mockPlugin({
      id: '@domain/base',
      workflowPatterns: () => [{
        name: 'checkout-flow',
        steps: [{ operationPattern: /list.*products/i, role: 'browse' }],
        edgeWeightBoost: 0.3,
      }],
    })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      workflowPatterns: () => [{
        name: 'return-flow',
        steps: [{ operationPattern: /create.*return/i, role: 'action' }],
        edgeWeightBoost: 0.2,
      }],
    })
    const result = composed.workflowPatterns!()
    expect(result).toHaveLength(2)
    expect(result.map(p => p.name)).toEqual(['checkout-flow', 'return-flow'])
  })

  it('enrichTools: non-overlapping keys are preserved from both base and override', () => {
    const base = mockPlugin({
      id: '@domain/base',
      enrichTools: () => {
        const m = new Map<string, ToolEnrichmentHint>()
        m.set('list_users', { descriptionSuffix: 'Base hint.' })
        return m
      },
    })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      enrichTools: () => {
        const m = new Map<string, ToolEnrichmentHint>()
        m.set('create_user', { descriptionSuffix: 'Child hint.' })
        return m
      },
    })
    const result = composed.enrichTools!([mockOp()])
    expect(result.get('list_users')!.descriptionSuffix).toBe('Base hint.')
    expect(result.get('create_user')!.descriptionSuffix).toBe('Child hint.')
    expect(result.size).toBe(2)
  })

  it('disambiguate: preserves sourceField and targetParam from original input', async () => {
    const base = mockPlugin({
      id: '@domain/base',
      disambiguate: async (matches) => matches.map(m => ({
        sourceOperationId: m.sourceOperationId,
        targetOperationId: m.targetOperationId,
        refinedScore: 0.5,
        confirmed: false,
        reasoning: 'base says maybe',
      })),
    })
    const composed = composeEnrichmentPlugin(base, {
      id: '@domain/child',
      name: 'Child',
      version: '1.0.0',
      disambiguate: async (matches) => matches.map(m => ({
        sourceOperationId: m.sourceOperationId,
        targetOperationId: m.targetOperationId,
        refinedScore: m.sourceField === 'id' && m.targetParam === 'userId' ? 0.95 : 0.1,
        confirmed: m.sourceField === 'id',
        reasoning: `field=${m.sourceField}, param=${m.targetParam}`,
      })),
    })
    const result = await composed.disambiguate!([{
      sourceOperationId: 'op_a',
      targetOperationId: 'op_b',
      sourceField: 'id',
      targetParam: 'userId',
      currentScore: 0.3,
      context: 'test',
    }])
    expect(result[0].refinedScore).toBe(0.95)
    expect(result[0].confirmed).toBe(true)
    expect(result[0].reasoning).toBe('field=id, param=userId')
  })
})
