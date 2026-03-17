/**
 * Integration tests verifying that enrichment plugin field categories
 * flow through to the semantic detection pipeline.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { enrichmentRegistry } from './registry'
import { detectSemantics, clearSemanticCache, setCustomCategoriesProvider } from '../semantic/detector'
import type { EnrichmentPlugin } from '../types/enrichment'
import type { PluginSemanticCategory } from '../types/plugins'

beforeEach(() => {
  // Wire enrichment registry categories into the detection pipeline (as app/server layers do)
  setCustomCategoriesProvider(() => enrichmentRegistry.getAllFieldCategories())
})

afterEach(() => {
  enrichmentRegistry.clear()
  clearSemanticCache()
  // Reset to default empty provider
  setCustomCategoriesProvider(() => [])
})

describe('Enrichment plugin → detector integration', () => {
  it('enrichment plugin field categories are detected by detectSemantics', () => {
    // Register a plugin with a custom category
    const customCategory: PluginSemanticCategory = {
      id: '@test/tracking-code',
      name: 'Tracking Code',
      description: 'Shipment tracking code',
      namePatterns: [/tracking[_-]?code/i, /track[_-]?number/i],
      validate: (value) => typeof value === 'string' && value.length > 5,
    }

    const plugin: EnrichmentPlugin = {
      id: '@test/shipping',
      name: 'Shipping Enrichment',
      version: '1.0.0',
      fieldCategories: [customCategory],
    }

    enrichmentRegistry.register(plugin)

    // The detector should now pick up the custom category
    const results = detectSemantics(
      'order.tracking_code',
      'tracking_code',
      'string',
      ['1Z999AA10123456784', 'FEDEX-123456789'],
    )

    // Should find the custom category with positive confidence
    const match = results.find(r => r.category === '@test/tracking-code')
    expect(match).toBeDefined()
    expect(match!.confidence).toBeGreaterThan(0)
  })

  it('removing an enrichment plugin removes its categories from detection', () => {
    // Use a very distinctive name that won't match any core category
    const customCategory: PluginSemanticCategory = {
      id: '@test/xyzzy-code',
      name: 'Xyzzy Code',
      description: 'Custom xyzzy identifier',
      namePatterns: [/xyzzy[_-]?code/i],
      validate: (value) => typeof value === 'string' && value.startsWith('XZ-'),
    }

    enrichmentRegistry.register({
      id: '@test/xyzzy',
      name: 'Xyzzy Enrichment',
      version: '1.0.0',
      fieldCategories: [customCategory],
    })

    // Should detect it
    let results = detectSemantics('item.xyzzy_code', 'xyzzy_code', 'string', ['XZ-12345', 'XZ-67890'])
    let match = results.find(r => r.category === '@test/xyzzy-code')
    expect(match).toBeDefined()
    expect(match!.confidence).toBeGreaterThan(0)

    // Unregister and clear cache
    enrichmentRegistry.unregister('@test/xyzzy')
    clearSemanticCache()

    // Should no longer detect it
    results = detectSemantics('item.xyzzy_code', 'xyzzy_code', 'string', ['XZ-12345', 'XZ-67890'])
    match = results.find(r => r.category === '@test/xyzzy-code')
    expect(match).toBeUndefined()
  })
})
